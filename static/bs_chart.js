/* ============================================
   资产负债结构分析 — 渲染模块（风格无关版）
   两种数据入口统一由 app.js 驱动：
   1. 在线获取：app.js 调 POST /api/fetch-all 后
      通过 window.renderBsResult(data.bs, ...) 渲染；
   2. 手动上传：app.js 调 POST /api/bs-chart 后
      同样通过 window.renderBsResult 渲染。
   DOM ID 带 Bs 后缀，与个股财报部分隔离。
   ============================================ */

(function () {
    'use strict';

    var T = window.APP_THEME;

    var resultSection = document.getElementById('resultSectionBs');
    var sectionTitle = document.getElementById('sectionTitleBs');
    var chartSub = document.getElementById('chartSubBs');
    var chartCanvas = document.getElementById('chartCanvasBs');
    var rawCount = document.getElementById('rawCount');
    var totalVal = document.getElementById('totalVal');
    var assetLegendMeta = document.getElementById('assetLegendMeta');
    var liabLegendMeta = document.getElementById('liabLegendMeta');

    // KPI 指标条
    var kpiAsset = document.getElementById('kpiAsset');
    var kpiLiab = document.getElementById('kpiLiab');
    var kpiNet = document.getElementById('kpiNet');
    var kpiRatio = document.getElementById('kpiRatio');
    var kpiRaw = document.getElementById('kpiRaw');

    var assetTable = document.getElementById('assetTable');
    var liabTable = document.getElementById('liabTable');
    var assetSum = document.getElementById('assetSum');
    var liabSum = document.getElementById('liabSum');

    var jsonToggle = document.getElementById('jsonToggleBs');
    var jsonContent = document.getElementById('jsonContentBs');

    var chartInstance = null;

    var ASSET_COLOR = T.bsAsset;
    var ASSET_DEEP = T.bsAssetDeep;
    var LIAB_COLOR = T.bsLiab;
    var LIAB_DEEP = T.bsLiabDeep;
    var ASSET_COUNT = 9;

    if (!chartCanvas) return;

    function renderResult(data, skipScroll, companyName) {
        resultSection.hidden = false;
        // 区块标题拼接公司名（如「澜起科技 · 资产与负债分布」），无公司名时保持通用标题
        var label = companyName || '';
        if (sectionTitle) sectionTitle.textContent = (label ? label + ' · ' : '') + '资产与负债分布';
        chartSub.textContent = '报告期：' + (data.period || '—');
        var extra = data.extra || {};
        rawCount.textContent = extra.raw_rows_count || 0;
        totalVal.textContent = (data.total || 0).toFixed(2);
        renderChart(data);
        renderTables(data);
        renderKpi(data);
        jsonContent.textContent = JSON.stringify(data, null, 2);
        if (!skipScroll) {
            setTimeout(function () {
                resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    }

    // ── KPI 指标条 ───────────────────────────
    function renderKpi(data) {
        var labels = data.labels;
        var values = data.values;
        var assetCount = (data.extra && data.extra.asset_count) || ASSET_COUNT;
        var assetTotal = 0, liabTotal = 0;

        for (var i = 0; i < labels.length; i++) {
            if (i < assetCount) assetTotal += values[i] || 0;
            else liabTotal += values[i] || 0;
        }

        if (kpiAsset) kpiAsset.textContent = assetTotal.toFixed(2);
        if (kpiLiab) kpiLiab.textContent = liabTotal.toFixed(2);
        if (kpiNet) kpiNet.textContent = (assetTotal - liabTotal).toFixed(2);
        if (kpiRatio) kpiRatio.textContent = assetTotal > 0
            ? (liabTotal / assetTotal * 100).toFixed(1) + '%' : '—';
        if (kpiRaw) kpiRaw.textContent = (data.extra && data.extra.raw_rows_count) || 0;
    }

    // ── Chart.js 柱状图 ───────────────────────
    function renderChart(data) {
        if (chartInstance) chartInstance.destroy();

        var labels = data.labels;
        var values = data.values;
        var assetCount = (data.extra && data.extra.asset_count) || ASSET_COUNT;
        var maxVal = Math.max.apply(null, values);
        var ymax = Math.max(5, ((maxVal / 5) + 1) * 5);

        if (window.ChartDataLabels) Chart.register(ChartDataLabels);

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
                    borderRadius: T.barRadius,
                    borderSkipped: false,
                    borderWidth: 0,
                    maxBarThickness: 56
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 32 } },
                animation: { duration: 700, easing: 'easeOutQuart' },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: T.tooltipBg,
                        borderColor: T.tooltipBorder,
                        borderWidth: 1,
                        padding: 12,
                        titleColor: T.tooltipFg,
                        bodyColor: T.tooltipFg,
                        titleFont: { size: 12, family: T.font, weight: '600' },
                        bodyFont: { size: 12, family: T.font },
                        displayColors: false,
                        callbacks: {
                            label: function (c) { return c.parsed.y.toFixed(3) + ' 亿元'; }
                        }
                    },
                    datalabels: {
                        anchor: 'end',
                        align: 'top',
                        offset: 4,
                        color: T.text,
                        font: { size: 11, weight: '600', family: T.font },
                        formatter: function (v) { return v === 0 ? '' : v.toFixed(2); },
                        display: function (c) { return values[c.dataIndex] > 0; }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            color: T.text,
                            font: { size: 12, family: T.font },
                            autoSkip: false,
                            maxRotation: 45,
                            minRotation: 45
                        },
                        grid: { display: false },
                        border: { color: T.axisBorder, width: 1 }
                    },
                    y: {
                        beginAtZero: true,
                        max: ymax,
                        ticks: {
                            color: T.textMute,
                            font: { size: 11, family: T.font },
                            callback: function (v) { return v + ' 亿'; }
                        },
                        grid: { color: T.grid, drawTicks: false },
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
        assetSum.textContent = assetTotal.toFixed(2);
        liabSum.textContent = liabTotal.toFixed(2);
        assetLegendMeta.textContent = assetTotal.toFixed(2) + ' 亿元';
        liabLegendMeta.textContent = liabTotal.toFixed(2) + ' 亿元';
    }

    // ── JSON 折叠（details/summary）──────────
    if (jsonToggle) {
        jsonToggle.addEventListener('toggle', function () {
            jsonContent.hidden = !jsonToggle.open;
        });
    }

    // 暴露渲染函数：供 app.js 在线获取与手动上传两个流程调用（跳过滚动，由调用方控制定位）
    window.renderBsResult = renderResult;

})();
