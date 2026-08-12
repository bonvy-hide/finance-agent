/* ============================================
   资产负债结构分析 — 前端逻辑
   ============================================ */

(function () {
    'use strict';

    // ── DOM 引用 ──────────────────────────────
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName');
    const uploadBtn = document.getElementById('uploadBtn');
    const errorBox = document.getElementById('errorBox');
    const loadingBar = document.getElementById('loadingBar');
    const navStatus = document.getElementById('navStatus');
    const statusText = navStatus.querySelector('.status-text');
    const resultSection = document.getElementById('resultSection');
    const chartTitle = document.getElementById('chartTitle');
    const chartSub = document.getElementById('chartSub');
    const chartCanvas = document.getElementById('chartCanvas');
    const rawCount = document.getElementById('rawCount');
    const totalVal = document.getElementById('totalVal');
    const assetTable = document.getElementById('assetTable');
    const liabTable = document.getElementById('liabTable');
    const assetSum = document.getElementById('assetSum');
    const liabSum = document.getElementById('liabSum');
    const jsonToggle = document.getElementById('jsonToggle');
    const jsonContent = document.getElementById('jsonContent');

    let currentFile = null;
    let chartInstance = null;

    // ── 颜色常量 ──────────────────────────────
    const ASSET_COLOR = '#3a7ecf';
    const LIAB_COLOR = '#d63031';
    const ASSET_COUNT = 9;

    // ── 状态切换 ──────────────────────────────
    function setStatus(state, text) {
        navStatus.className = 'nav-status' + (state ? ' ' + state : '');
        statusText.textContent = text;
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
        // 避免点击上传按钮时重复触发
        if (e.target.closest('#uploadBtn')) return;
        fileInput.click();
    });

    fileInput.addEventListener('change', function (e) {
        if (e.target.files.length > 0) handleFile(e.target.files[0]);
    });

    // 拖拽
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
        if (!name.toLowerCase().endsWith('.xlsx')) {
            showError('仅支持 .xlsx 格式文件，请重新选择。');
            return;
        }
        currentFile = file;
        fileInfo.hidden = false;
        fileName.textContent = name + ' (' + formatSize(file.size) + ')';
        uploadBtn.disabled = false;
        setStatus('', '已选择文件');
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
        setStatus('loading', '解析中…');

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

        // 标题
        chartTitle.textContent = data.title || '资产负债结构';
        chartSub.textContent = '报告期：' + (data.period || '—');

        // 统计信息
        var extra = data.extra || {};
        rawCount.textContent = extra.raw_rows_count || 0;
        totalVal.textContent = (data.total || 0).toFixed(2);

        // 图表
        renderChart(data);

        // 表格
        renderTables(data);

        // JSON
        jsonContent.textContent = JSON.stringify(data, null, 2);

        // 滚动到结果
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

        // 注册 datalabels
        if (window.ChartDataLabels) {
            Chart.register(ChartDataLabels);
        }

        var ctx = chartCanvas.getContext('2d');

        // 渐变色
        var gradAsset = ctx.createLinearGradient(0, 0, 0, 400);
        gradAsset.addColorStop(0, '#5ba3f5');
        gradAsset.addColorStop(1, '#2a5f9e');

        var gradLiab = ctx.createLinearGradient(0, 0, 0, 400);
        gradLiab.addColorStop(0, '#e74c3c');
        gradLiab.addColorStop(1, '#a02418');

        chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '金额（亿元）',
                    data: values,
                    backgroundColor: function (ctx) {
                        return ctx.dataIndex < assetCount ? gradAsset : gradLiab;
                    },
                    borderRadius: 6,
                    borderSkipped: false,
                    borderWidth: 0,
                    maxBarThickness: 56
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 36 } },
                animation: {
                    duration: 1000,
                    easing: 'easeOutQuart'
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15,15,30,0.95)',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 12,
                        titleColor: '#fff',
                        bodyColor: '#c0c0d0',
                        titleFont: { size: 13, family: "'Noto Sans SC', sans-serif" },
                        bodyFont: { size: 13, family: "'Noto Sans SC', sans-serif" },
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
                        color: '#fff',
                        font: { size: 11, weight: 600, family: "'Noto Sans SC', sans-serif" },
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
                            color: '#a0a0b0',
                            font: { size: 11, family: "'Noto Sans SC', sans-serif" },
                            autoSkip: false,
                            maxRotation: 45,
                            minRotation: 45
                        },
                        grid: { display: false },
                        border: { color: 'rgba(255,255,255,0.1)' }
                    },
                    y: {
                        beginAtZero: true,
                        max: ymax,
                        ticks: {
                            color: '#a0a0b0',
                            font: { size: 11, family: "'Noto Sans SC', sans-serif" },
                            callback: function (v) { return v + ' 亿'; }
                        },
                        grid: { color: 'rgba(255,255,255,0.06)' },
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
                    '<div class="row-bar"><div class="row-bar-fill" style="width:' + Math.min(pct * 2, 100) + '%"></div></div>' +
                '</div>';

            if (isAsset) assetHtml += row;
            else liabHtml += row;
        }

        assetTable.innerHTML = assetHtml;
        liabTable.innerHTML = liabHtml;
        assetSum.textContent = assetTotal.toFixed(2) + ' 亿元';
        liabSum.textContent = liabTotal.toFixed(2) + ' 亿元';
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

})();
