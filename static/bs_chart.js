/* ============================================
   资产负债结构分析 — 前端逻辑（经典金融报告风）
   单页模式：所有 DOM ID 带 Bs 后缀，避免与个股财报页冲突
   ============================================ */

(function () {
    'use strict';

    // ── DOM 引用（全部带 Bs 后缀，与个股财报页隔离）─────
    const dropzone = document.getElementById('dropzoneBs');
    const fileInput = document.getElementById('fileInputBs');
    const fileInfo = document.getElementById('fileInfoBs');
    const fileName = document.getElementById('fileNameBs');
    const uploadBtn = document.getElementById('uploadBtnBs');
    const errorBox = document.getElementById('errorBoxBs');
    const loadingBar = document.getElementById('loadingBarBs');

    // mastheadDate / mastheadStatus 是全局共享的，这里只读不重复初始化
    const mastheadStatus = document.getElementById('mastheadStatus');
    const statusLabel = mastheadStatus ? mastheadStatus.querySelector('.status-label') : null;
    const heroEdition = document.getElementById('heroEditionBs');

    const resultSection = document.getElementById('resultSectionBs');
    const chartSub = document.getElementById('chartSubBs');
    const chartCanvas = document.getElementById('chartCanvasBs');
    const rawCount = document.getElementById('rawCount');
    const totalVal = document.getElementById('totalVal');
    const assetLegendMeta = document.getElementById('assetLegendMeta');
    const liabLegendMeta = document.getElementById('liabLegendMeta');

    const assetTable = document.getElementById('assetTable');
    const liabTable = document.getElementById('liabTable');
    const assetSum = document.getElementById('assetSum');
    const liabSum = document.getElementById('liabSum');

    const jsonToggle = document.getElementById('jsonToggleBs');
    const jsonContent = document.getElementById('jsonContentBs');

    let currentFile = null;
    let chartInstance = null;

    // ── 颜色常量（鼠尾草绿/勃艮第红）──────────
    const ASSET_COLOR = '#7a9070';
    const ASSET_DEEP = '#5e7558';
    const LIAB_COLOR = '#7a1f2b';
    const LIAB_DEEP = '#5a1620';
    const ASSET_COUNT = 9;

    // ── 初始化期数（日期由 app.js 统一初始化）──
    if (heroEdition) {
        heroEdition.textContent = Math.floor((Date.now() - Date.UTC(2024, 0, 1)) / (7 * 24 * 60 * 60 * 1000));
    }

    // ── 状态切换（复用全局 mastheadStatus）─────
    function setStatus(state, text) {
        if (!mastheadStatus || !statusLabel) return;
        mastheadStatus.className = 'masthead-status' + (state ? ' ' + state : '');
        statusLabel.textContent = text;
    }

    function showError(msg) {
        if (errorBox) {
            errorBox.hidden = false;
            errorBox.textContent = '⚠ ' + msg;
        }
        setStatus('error', '错误');
    }

    function clearError() {
        if (errorBox) errorBox.hidden = true;
    }

    // ── 文件选择 ──────────────────────────────
    if (!dropzone) return;  // DOM 不存在则不初始化

    dropzone.addEventListener('click', function (e) {
        if (e.target.closest('#uploadBtnBs')) return;
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
        if (!name.toLowerCase().endsWith('.xlsx') && !name.toLowerCase().endsWith('.xls')) {
            showError('仅支持 .xls / .xlsx 格式文件，请重新选择。');
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

    // ── 上传 & 请求 ──────────────────────────
    uploadBtn.addEventListener('click', function () {
        if (!currentFile) return;
        uploadAndRender();
    });

    async function uploadAndRender() {
        clearError();
        loadingBar.hidden = false;
        uploadBtn.disabled = true;
        setStatus('loading', '解析中');

        var formData = new FormData();
        formData.append('file', currentFile);

        try {
            var resp = await fetch('/api/bs-chart', { method: 'POST', body: formData });
            var data = await resp.json();

            if (!resp.ok) {
                throw new Error(data.detail || data.error || '解析失败');
            }
            renderResult(data);
            setStatus('', '分析完成');
        } catch (err) {
            showError(err.message || '网络错误，请重试');
        } finally {
            loadingBar.hidden = true;
            uploadBtn.disabled = false;
        }
    }

    // ── 渲染结果 ──────────────────────────────
    function renderResult(data) {
        resultSection.hidden = false;
        chartSub.textContent = '报告期：' + (data.period || '—');
        var extra = data.extra || {};
        rawCount.textContent = extra.raw_rows_count || 0;
        totalVal.textContent = (data.total || 0).toFixed(2);
        renderChart(data);
        renderTables(data);
        jsonContent.textContent = JSON.stringify(data, null, 2);
        setTimeout(function () {
            resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }

    // ── Chart.js 柱状图 ───────────────────────
    function renderChart(data) {
        if (chartInstance) {
            chartInstance.destroy();
        }

        var labels = data.labels;
        var values = data.values;
        var assetCount = (data.extra && data.extra.asset_count) || ASSET_COUNT;
        var maxVal = Math.max.apply(null, values);
        var ymax = Math.max(5, ((maxVal / 5) + 1) * 5);

        if (window.ChartDataLabels) {
            Chart.register(ChartDataLabels);
        }

        var ctx = chartCanvas.getContext('2d');

        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '金额（亿元）',
                    data: values,
                    backgroundColor: function (ctx) {
                        return ctx.dataIndex < assetCount ? ASSET_COLOR : LIAB_COLOR;
                    },
                    hoverBackgroundColor: function (ctx) {
                        return ctx.dataIndex < assetCount ? ASSET_DEEP : LIAB_DEEP;
                    },
                    borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 },
                    borderSkipped: false,
                    borderWidth: 0,
                    borderColor: '#f5f0e6',
                    maxBarThickness: 56
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 32 } },
                animation: { duration: 800, easing: 'easeOutQuart' },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#f5f0e6',
                        borderColor: '#b8956a',
                        borderWidth: 1,
                        padding: 12,
                        titleColor: '#2b1f15',
                        bodyColor: '#2b1f15',
                        titleFont: { size: 13, family: "'Noto Serif SC', serif", weight: '700' },
                        bodyFont: { size: 13, family: "'Noto Sans SC', sans-serif" },
                        displayColors: false,
                        callbacks: {
                            label: function (c) {
                                return c.parsed.y.toFixed(3) + ' 亿元';
                            }
                        }
                    },
                    datalabels: {
                        anchor: 'end',
                        align: 'top',
                        offset: 4,
                        color: '#2b1f15',
                        font: { size: 11, weight: '600', family: "'Noto Sans SC', sans-serif" },
                        formatter: function (v) {
                            return v === 0 ? '' : v.toFixed(2);
                        },
                        display: function (c) {
                            return values[c.dataIndex] > 0;
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            color: '#5a4a38',
                            font: { size: 12, family: "'Noto Serif SC', serif", weight: '500' },
                            autoSkip: false,
                            maxRotation: 45,
                            minRotation: 45
                        },
                        grid: { display: false },
                        border: { color: '#2b1f15', width: 1 }
                    },
                    y: {
                        beginAtZero: true,
                        max: ymax,
                        ticks: {
                            color: '#8a7a64',
                            font: { size: 11, family: "'Noto Sans SC', sans-serif" },
                            callback: function (v) { return v + ' 亿'; }
                        },
                        grid: { color: 'rgba(184, 149, 106, 0.25)', drawTicks: false },
                        border: { display: false }
                    }
                }
            }
        });
    }

    // ── 数据表格 ──────────────────────────────
    function renderTables(data) {
        var labels = data.labels;
        var values = data.values;
        var total = data.total || 1;
        var assetCount = (data.extra && data.extra.asset_count) || ASSET_COUNT;
        var assetTotal = 0, liabTotal = 0;

        var assetHtml = '';
        var liabHtml = '';

        for (var i = 0; i < labels.length; i++) {
            var name = labels[i];
            var val = values[i] || 0;
            var pct = total > 0 ? (val / total * 100) : 0;
            var isAsset = i < assetCount;

            if (isAsset) assetTotal += val;
            else liabTotal += val;

            var row = '' +
                '<div class="table-row">' +
                    '<span class="row-name">' + name + '</span>' +
                    '<span class="row-value">' + val.toFixed(2) + '</span>' +
                    '<span class="row-pct">' + pct.toFixed(1) + '%</span>' +
                '</div>';

            if (isAsset) assetHtml += row;
            else liabHtml += row;
        }

        assetTable.innerHTML = assetHtml;
        liabTable.innerHTML = liabHtml;
        assetSum.textContent = assetTotal.toFixed(2) + ' 亿';
        liabSum.textContent = liabTotal.toFixed(2) + ' 亿';
        assetLegendMeta.textContent = assetTotal.toFixed(2) + ' 亿元';
        liabLegendMeta.textContent = liabTotal.toFixed(2) + ' 亿元';
    }

    // ── JSON 折叠 ─────────────────────────────
    if (jsonToggle) {
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
    }

})();
