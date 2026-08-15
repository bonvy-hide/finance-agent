/* ============================================
   个股财报多维分析 — 前端逻辑（经典金融报告风）
   上传 .xls + 公司名 → 并发请求 6 个图表 → 渲染
   ============================================ */

(function () {
    'use strict';

    // ── DOM 引用 ──────────────────────────────
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const companyInput = document.getElementById('companyInput');
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName');
    const uploadBtn = document.getElementById('uploadBtn');
    const errorBox = document.getElementById('errorBox');
    const loadingBar = document.getElementById('loadingBar');

    const mastheadDate = document.getElementById('mastheadDate');
    const heroEdition = document.getElementById('heroEdition');
    const mastheadStatus = document.getElementById('mastheadStatus');
    const statusLabel = mastheadStatus.querySelector('.status-label');

    const resultSection = document.getElementById('resultSection');
    const chartSub = document.getElementById('chartSub');
    const jsonToggle = document.getElementById('jsonToggle');
    const jsonContent = document.getElementById('jsonContent');

    // 数据摘要
    const sumCompany = document.getElementById('sumCompany');
    const sumPeriods = document.getElementById('sumPeriods');
    const sumRange = document.getElementById('sumRange');
    const sumColumns = document.getElementById('sumColumns');
    const sumSource = document.getElementById('sumSource');

    let currentFile = null;
    // 6 个 Chart 实例，按 chart_name 索引
    const chartInstances = {};
    // 6 个图表的原始数据，用于全屏重建
    const chartDataCache = {};
    // 全屏 Chart 实例
    let fullscreenChart = null;

    // ── DOM：全屏覆盖层 ──────────────────────
    const fullscreenOverlay = document.getElementById('fullscreenOverlay');
    const fullscreenCanvas = document.getElementById('fullscreenCanvas');
    const fullscreenTitle = document.getElementById('fullscreenTitle');
    const btnCloseFullscreen = document.getElementById('btnCloseFullscreen');
    const btnResetZoom = document.getElementById('btnResetZoom');

    // ── 6 个图表配置（路由名 → 显示信息）─────
    const CHART_DEFS = [
        { name: 'revenue-cashflow',    typeLabel: '折线图' },
        { name: 'profit-cashflow-fcf', typeLabel: '折线图' },
        { name: 'cost-margin',         typeLabel: '柱+折线' },
        { name: 'three-expenses',      typeLabel: '柱+折线' },
        { name: 'revenue-payable',     typeLabel: '柱+折线' },
        { name: 'rd-profit',           typeLabel: '柱+折线' },
    ];

    // ── 初始化刊头日期/期数 ──────────────────
    (function initHeader() {
        const d = new Date();
        const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
        mastheadDate.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · ${weekday}`;
        heroEdition.textContent = Math.floor((Date.now() - Date.UTC(2024, 0, 1)) / (7 * 24 * 60 * 60 * 1000));
    })();

    // ── 菜单切换（单页模式，不刷新页面以保留数据）─────
    const pageStock = document.getElementById('page-stock');
    const pageBs = document.getElementById('page-bs');
    const navLinks = document.querySelectorAll('.masthead-nav .nav-link[data-page]');

    navLinks.forEach(function (link) {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            var targetPage = link.getAttribute('data-page');
            if (!targetPage) return;

            // 切换 page-container 显示
            if (targetPage === 'stock') {
                pageStock.hidden = false;
                pageBs.hidden = true;
            } else if (targetPage === 'bs') {
                pageStock.hidden = true;
                pageBs.hidden = false;
            }

            // 切换菜单 active 高亮
            navLinks.forEach(function (l) { l.classList.remove('active'); });
            link.classList.add('active');

            // 滚动到顶部
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    // ── 状态切换 ──────────────────────────────
    function setStatus(state, text) {
        mastheadStatus.className = 'masthead-status' + (state ? ' ' + state : '');
        statusLabel.textContent = text;
    }

    function showError(msg) {
        errorBox.hidden = false;
        errorBox.textContent = '⚠ ' + msg;
        setStatus('error', '错误');
    }

    function clearError() {
        errorBox.hidden = true;
    }

    // ── 文件选择 ──────────────────────────────
    dropzone.addEventListener('click', function (e) {
        if (e.target.closest('#uploadBtn') || e.target.closest('#companyInput')) return;
        fileInput.click();
    });

    fileInput.addEventListener('change', function (e) {
        if (e.target.files.length > 0) handleFile(e.target.files[0]);
    });

    ['dragenter', 'dragover'].forEach(function (evt) {
        dropzone.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(function (evt) {
        dropzone.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover');
        });
    });

    dropzone.addEventListener('drop', function (e) {
        var files = e.dataTransfer.files;
        if (files.length > 0) handleFile(files[0]);
    });

    function handleFile(file) {
        clearError();
        var name = file.name || '';
        if (!name.toLowerCase().endsWith('.xls')) {
            showError('仅支持 .xls 格式文件（diy_report 模板），请重新选择。');
            return;
        }
        currentFile = file;
        fileInfo.hidden = false;
        fileName.textContent = name + ' · ' + formatSize(file.size);
        uploadBtn.disabled = false;
        setStatus('', '已选文件');
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    // 公司名输入时，若已选文件则启用上传按钮
    companyInput.addEventListener('input', function () {
        if (currentFile) {
            uploadBtn.disabled = !companyInput.value.trim();
        }
    });

    // ── 上传 & 请求 ──────────────────────────
    uploadBtn.addEventListener('click', function () {
        if (!currentFile) return;
        if (!companyInput.value.trim()) {
            showError('请输入公司名称');
            companyInput.focus();
            return;
        }
        uploadAndRender();
    });

    async function uploadAndRender() {
        clearError();
        loadingBar.hidden = false;
        uploadBtn.disabled = true;
        setStatus('loading', '解析中');

        var formData = new FormData();
        formData.append('file', currentFile);
        formData.append('company_name', companyInput.value.trim());

        try {
            // 1. 上传 .xls，获取 data_id
            var resp = await fetch('/api/normalize', { method: 'POST', body: formData });
            var data = await resp.json();

            if (!resp.ok) {
                throw new Error(data.detail || data.error || '解析失败');
            }

            // 2. 并发请求 6 个图表
            await renderAllCharts(data.data_id, data.company_name);

            // 3. 渲染数据摘要 + JSON
            renderSummary(data);
            setStatus('', '分析完成');
        } catch (err) {
            showError(err.message || '网络错误，请重试');
        } finally {
            loadingBar.hidden = true;
            uploadBtn.disabled = false;
        }
    }

    // ── 并发渲染 6 个图表 ─────────────────────
    async function renderAllCharts(dataId, companyName) {
        resultSection.hidden = false;
        chartSub.textContent = '公司：' + companyName;

        // 销毁旧实例
        Object.keys(chartInstances).forEach(function (key) {
            if (chartInstances[key]) {
                chartInstances[key].destroy();
                delete chartInstances[key];
            }
        });

        // 并发请求所有图表
        var promises = CHART_DEFS.map(function (def) {
            return fetch('/api/charts/' + def.name + '?data_id=' + encodeURIComponent(dataId))
                .then(function (r) { return r.json(); })
                .then(function (chartData) {
                    return { def: def, chartData: chartData, ok: true };
                })
                .catch(function (err) {
                    return { def: def, chartData: null, ok: false, err: err };
                });
        });

        var results = await Promise.all(promises);

        // 逐个渲染
        results.forEach(function (result) {
            var def = result.def;
            var titleEl = document.getElementById('title-' + def.name);
            var typeEl = document.getElementById('type-' + def.name);
            var canvas = document.getElementById('canvas-' + def.name);
            var card = document.querySelector('.stock-chart-card[data-chart="' + def.name + '"]');

            if (result.ok && result.chartData) {
                titleEl.textContent = result.chartData.title;
                typeEl.textContent = def.typeLabel;
                renderChart(canvas, result.chartData, def.name);
                // 缓存数据供全屏重建使用
                chartDataCache[def.name] = result.chartData;
                // 注入放大按钮（避免重复）
                if (card && !card.querySelector('.btn-zoom')) {
                    var zoomBtn = document.createElement('button');
                    zoomBtn.className = 'btn-zoom';
                    zoomBtn.title = '放大查看';
                    zoomBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';
                    zoomBtn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        openFullscreen(def.name);
                    });
                    card.appendChild(zoomBtn);
                }
            } else {
                titleEl.textContent = '加载失败';
                typeEl.textContent = def.typeLabel;
                console.error('图表 ' + def.name + ' 加载失败:', result.err);
            }
        });

        // 滚动到结果
        setTimeout(function () {
            resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }

    // ── Chart.js 渲染（支持 line / mixed）─────
    function renderChart(canvas, chartData, chartName, enableZoom) {
        if (window.ChartDataLabels) {
            Chart.register(ChartDataLabels);
        }
        if (window.ChartZoom) {
            Chart.register(ChartZoom);
        }

        var labels = chartData.labels || [];
        var extra = chartData.extra || {};
        var series = extra.series || [];
        var scales = extra.scales || {};
        var chartType = chartData.chart_type || 'line';

        // 构建 datasets
        var datasets = series.map(function (s) {
            var ds = {
                label: s.name,
                data: s.data,
                borderColor: s.color,
                backgroundColor: s.type === 'bar' ? s.color : hexToRgba(s.color, 0.1),
                borderWidth: s.type === 'bar' ? 0 : 2,
                tension: 0.35,
                fill: s.type === 'line' ? false : undefined,
                pointRadius: s.type === 'line' ? 0 : undefined,
                pointHoverRadius: s.type === 'line' ? 5 : undefined,
                pointBackgroundColor: s.color,
                pointBorderColor: '#f5f0e6',
                pointBorderWidth: 1.5,
                yAxisID: s.y_axis === 'right' ? 'yRight' : 'yLeft',
                type: s.type,
                order: s.type === 'bar' ? 2 : 1,  // 折线在上层
            };
            if (s.type === 'bar') {
                ds.borderRadius = 2;
                ds.maxBarThickness = 28;
            }
            return ds;
        });

        // 构建 scales 配置
        var chartScales = {
            x: {
                ticks: {
                    color: '#5a4a38',
                    font: { size: 10, family: "'Noto Sans SC', sans-serif", weight: '500' },
                    autoSkip: false,
                    maxRotation: 60,
                    minRotation: 60,
                    padding: 4,
                    // 用 callback 把日期格式从 YYYY-MM-DD 缩为 YYYY-Qn，便于在密集空间下显示
                    callback: function (value, index) {
                        var label = this.getLabelForValue(value);
                        var m = /-(\d{2})-/.exec(label);
                        if (m) {
                            var q = Math.floor(parseInt(m[1], 10) / 3) + 1;
                            return label.substring(0, 4) + '-Q' + q;
                        }
                        return label;
                    }
                },
                grid: { display: false },
                border: { color: '#2b1f15', width: 1 }
            }
        };

        // 左轴（必有）
        var leftScale = scales.left || {};
        chartScales.yLeft = {
            position: 'left',
            beginAtZero: true,
            title: {
                display: !!leftScale.title,
                text: leftScale.title || '',
                color: '#5a4a38',
                font: { size: 12, family: "'Noto Sans SC', sans-serif", weight: '500' }
            },
            ticks: {
                color: '#8a7a64',
                font: { size: 11, family: "'Noto Sans SC', sans-serif" },
                callback: function (v) {
                    return leftScale.unit === '%' ? (v * 100).toFixed(1) + '%' : v.toFixed(1);
                }
            },
            grid: { color: 'rgba(184, 149, 106, 0.25)', drawTicks: false },
            border: { display: false }
        };

        // 右轴（mixed 类型才有）
        if (scales.right) {
            var rightScale = scales.right;
            chartScales.yRight = {
                position: 'right',
                beginAtZero: true,
                title: {
                    display: !!rightScale.title,
                    text: rightScale.title || '',
                    color: '#5a4a38',
                    font: { size: 12, family: "'Noto Sans SC', sans-serif", weight: '500' }
                },
                ticks: {
                    color: '#8a7a64',
                    font: { size: 11, family: "'Noto Sans SC', sans-serif" },
                    callback: function (v) {
                        return rightScale.unit === '%' ? (v * 100).toFixed(1) + '%' : v.toFixed(1);
                    }
                },
                grid: { display: false },
                border: { display: false }
            };
        }

        var ctx = canvas.getContext('2d');
        var instance = new Chart(ctx, {
            type: chartType === 'mixed' ? 'bar' : chartType,
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                layout: { padding: { top: 16, right: 24, bottom: 8, left: 8 } },
                animation: { duration: 800, easing: 'easeOutQuart' },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'end',
                        labels: {
                            color: '#5a4a38',
                            font: { size: 12, family: "'Noto Sans SC', sans-serif", weight: '500' },
                            boxWidth: 14,
                            boxHeight: 14,
                            padding: 16,
                            usePointStyle: false
                        }
                    },
                    tooltip: {
                        backgroundColor: '#f5f0e6',
                        borderColor: '#b8956a',
                        borderWidth: 1,
                        padding: 12,
                        titleColor: '#2b1f15',
                        bodyColor: '#2b1f15',
                        titleFont: { size: 13, family: "'Noto Serif SC', serif", weight: '700' },
                        bodyFont: { size: 12, family: "'Noto Sans SC', sans-serif" },
                        displayColors: true,
                        boxWidth: 10,
                        boxHeight: 10,
                        callbacks: {
                            label: function (c) {
                                var val = c.parsed.y;
                                if (val === null || val === undefined) return null;
                                var ds = c.dataset;
                                var unit = '亿';
                                // 从 series 中找对应单位
                                var s = series[c.datasetIndex];
                                if (s && s.unit === '%') {
                                    return ds.label + ': ' + (val * 100).toFixed(2) + '%';
                                }
                                return ds.label + ': ' + val.toFixed(3) + ' 亿';
                            }
                        }
                    },
                    datalabels: { display: false },
                    zoom: enableZoom ? {
                        pan: {
                            enabled: true,
                            mode: 'xy',
                            modifierKey: null
                        },
                        zoom: {
                            wheel: { enabled: true, speed: 0.1 },
                            pinch: { enabled: true },
                            mode: 'xy'
                        },
                        limits: {
                            x: { min: 'original', max: 'original' },
                            y: { min: 'original', max: 'original' }
                        }
                    } : false
                },
                scales: chartScales
            }
        });

        // 存储实例：全屏模式不污染 chartInstances（用独立变量管理）
        if (!enableZoom) {
            chartInstances[chartName] = instance;
        }
        return instance;
    }

    // ── hex 转 rgba ──────────────────────────
    function hexToRgba(hex, alpha) {
        var h = hex.replace('#', '');
        if (h.length === 3) {
            h = h.split('').map(function (c) { return c + c; }).join('');
        }
        var r = parseInt(h.substring(0, 2), 16);
        var g = parseInt(h.substring(2, 4), 16);
        var b = parseInt(h.substring(4, 6), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    // ── 数据摘要 ──────────────────────────────
    function renderSummary(data) {
        sumCompany.textContent = data.company_name || '—';
        sumPeriods.textContent = (data.periods || []).length + ' 期';
        var periods = data.periods || [];
        sumRange.textContent = periods.length > 0 ? (periods[0] + ' ~ ' + periods[periods.length - 1]) : '—';
        sumColumns.textContent = (data.columns || []).length + ' 列';
        sumSource.textContent = data.source_file || '—';

        // JSON 附录
        jsonContent.textContent = JSON.stringify(data, null, 2);
    }

    // ── JSON 折叠 ─────────────────────────────
    jsonToggle.addEventListener('click', function () {
        var isOpen = !jsonContent.hidden;
        if (isOpen) {
            jsonContent.hidden = true;
            jsonToggle.classList.remove('open');
        } else {
            jsonContent.hidden = false;
            jsonToggle.classList.add('open');
        }
    });

    // ── 全屏放大 ─────────────────────────────
    function openFullscreen(chartName) {
        var chartData = chartDataCache[chartName];
        if (!chartData) return;

        // 销毁旧的全屏 Chart
        if (fullscreenChart) {
            fullscreenChart.destroy();
            fullscreenChart = null;
        }

        fullscreenTitle.textContent = chartData.title;
        fullscreenOverlay.hidden = false;
        document.body.style.overflow = 'hidden';

        // 延迟一帧确保 canvas 已可见，否则尺寸为 0
        requestAnimationFrame(function () {
            fullscreenChart = renderChart(fullscreenCanvas, chartData, chartName, true);
            return fullscreenChart;
        });
    }

    function closeFullscreen() {
        fullscreenOverlay.hidden = true;
        document.body.style.overflow = '';
        if (fullscreenChart) {
            fullscreenChart.destroy();
            fullscreenChart = null;
        }
    }

    btnCloseFullscreen.addEventListener('click', closeFullscreen);
    btnResetZoom.addEventListener('click', function () {
        if (fullscreenChart) {
            fullscreenChart.resetZoom();
        }
    });

    // 点击覆盖层空白处关闭
    fullscreenOverlay.addEventListener('click', function (e) {
        if (e.target === fullscreenOverlay) closeFullscreen();
    });

    // ESC 关闭
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !fullscreenOverlay.hidden) {
            closeFullscreen();
        }
    });

})();
