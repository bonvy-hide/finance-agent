/* ============================================
   财务图表分析平台 — 前端逻辑（风格无关版）
   两种数据入口：
   1. 在线获取：POST /api/fetch-all?code=xxxxxx，
      一次返回个股财报标准化数据与资产负债结构两套结果；
   2. 手动上传（统一单表单）：公司名 + 两个文件格，
      POST /api/bs-chart（资产负债表）与 POST /api/normalize（个股 .xls），
      选了哪个文件就生成哪套图表。
   配色与字体从 index.html 的 APP_THEME 读取。
   ============================================ */

(function () {
    'use strict';

    var T = window.APP_THEME; // 主题常量：由 index.html 在本脚本之前定义

    // ── DOM 引用 ──────────────────────────────
    // 手动上传统一表单（公司名 + 两个文件格 + 生成按钮）
    var manualForm = document.getElementById('manualForm');
    var manualCompany = document.getElementById('manualCompany');
    var manualGenBtn = document.getElementById('manualGenBtn');
    var manualGenText = document.getElementById('manualGenText');
    var errorBoxManual = document.getElementById('errorBoxManual');
    var loadingBarManual = document.getElementById('loadingBarManual');

    var mastheadStatus = document.getElementById('mastheadStatus');
    var statusLabel = mastheadStatus ? mastheadStatus.querySelector('.status-label') : null;

    var resultSection = document.getElementById('resultSection');
    var resultSectionBs = document.getElementById('resultSectionBs');
    var entryCard = document.querySelector('.entry-card');

    // ── 模式独立结果仓库 ───────────────────────
    // 两个 tab 各自保存图表原始数据：切换 tab 时按目标模式的数据重渲染，
    // 互不覆盖丢失；只有点该 tab 的「清除」按钮才丢弃数据并复位表单。
    var currentMode = 'online';
    var modeData = {
        online: { bs: null, bsCompany: '', stock: null },  // bs: ChartResponse；stock: NormalizeResponse
        manual: { bs: null, bsCompany: '', stock: null }
    };

    function emptyModeState() {
        return { bs: null, bsCompany: '', stock: null };
    }
    var chartSub = document.getElementById('chartSub');
    var jsonToggle = document.getElementById('jsonToggle');
    var jsonContent = document.getElementById('jsonContent');

    var sumCompany = document.getElementById('sumCompany');
    var sumPeriods = document.getElementById('sumPeriods');
    var sumRange = document.getElementById('sumRange');
    var sumColumns = document.getElementById('sumColumns');
    var sumSource = document.getElementById('sumSource');

    var bsFile = null;         // 手动上传：已选资产负债表文件
    var stockFile = null;      // 手动上传：已选个股财报文件
    var chartInstances = {};   // 6 个 Chart 实例，按 chart_name 索引
    var chartDataCache = {};   // 原始数据缓存，用于全屏重建
    var fullscreenChart = null;

    var fullscreenOverlay = document.getElementById('fullscreenOverlay');
    var fullscreenCanvas = document.getElementById('fullscreenCanvas');
    var fullscreenTitle = document.getElementById('fullscreenTitle');
    var btnCloseFullscreen = document.getElementById('btnCloseFullscreen');
    var btnResetZoom = document.getElementById('btnResetZoom');

    var CHART_DEFS = [
        { name: 'revenue-cashflow' },
        { name: 'profit-cashflow-fcf' },
        { name: 'cost-margin' },
        { name: 'three-expenses' },
        { name: 'revenue-payable' },
        { name: 'roe-growth' },
        { name: 'eps-growth' }
    ];

    // ── 入口模式切换（在线获取 / 手动上传）──────
    var modeTabs = document.querySelectorAll('.mode-tab[data-mode]');
    var panelOnline = document.getElementById('modeOnline');
    var panelManual = document.getElementById('modeManual');

    // 切换 tab：按目标模式保存的数据重渲染结果区（图表不丢失），
    // 有结果定位到首个结果区，无结果回到入口表单
    function switchToMode(mode) {
        currentMode = mode;
        panelOnline.hidden = mode !== 'online';
        panelManual.hidden = mode !== 'manual';

        var state = modeData[mode];
        if (state.bs && window.renderBsResult) window.renderBsResult(state.bs, true, state.bsCompany);
        if (state.stock) {
            renderAllCharts(state.stock, true);
            renderSummary(state.stock);
        }
        resultSectionBs.hidden = !state.bs;
        resultSection.hidden = !state.stock;

        var target = state.bs ? resultSectionBs : (state.stock ? resultSection : entryCard);
        setTimeout(function () {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
    }

    modeTabs.forEach(function (btn) {
        btn.addEventListener('click', function () {
            modeTabs.forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            switchToMode(btn.getAttribute('data-mode'));
        });
    });

    // ── 状态 / 错误 ───────────────────────────
    function setStatus(state, text) {
        if (!mastheadStatus || !statusLabel) return;
        mastheadStatus.className = 'status' + (state ? ' ' + state : '');
        statusLabel.textContent = text;
    }

    function showErrorManual(msg) {
        errorBoxManual.hidden = false;
        errorBoxManual.textContent = '⚠ ' + msg;
        setStatus('error', '错误');
    }

    function clearErrorManual() { errorBoxManual.hidden = true; }

    // ── 手动上传：文件格（点击选择 / 拖拽 / 清除）──
    var slotConfig = [
        {
            key: 'bs', label: '资产负债表', accept: ['.xls', '.xlsx'], acceptText: '.xls / .xlsx',
            slot: document.getElementById('fileSlotBs'),
            input: document.getElementById('fileInputBs'),
            hint: document.getElementById('slotHintBs'),
            fileBar: document.getElementById('slotFileBs'),
            nameEl: document.getElementById('slotNameBs'),
            clearBtn: document.getElementById('slotClearBs')
        },
        {
            key: 'stock', label: '个股财报', accept: ['.xls'], acceptText: '.xls（diy_report 模板）',
            slot: document.getElementById('fileSlot'),
            input: document.getElementById('fileInput'),
            hint: document.getElementById('slotHint'),
            fileBar: document.getElementById('slotFile'),
            nameEl: document.getElementById('slotName'),
            clearBtn: document.getElementById('slotClear')
        }
    ];

    function getSlotFile(cfg) { return cfg.key === 'bs' ? bsFile : stockFile; }

    function setSlotFile(cfg, file) {
        if (cfg.key === 'bs') bsFile = file; else stockFile = file;
        if (file) {
            cfg.slot.classList.add('filled');
            cfg.fileBar.hidden = false;
            cfg.hint.hidden = true;
            cfg.nameEl.textContent = file.name + ' · ' + formatSize(file.size);
        } else {
            cfg.slot.classList.remove('filled');
            cfg.fileBar.hidden = true;
            cfg.hint.hidden = false;
            cfg.input.value = '';   // 允许重复选择同一个文件
        }
        updateGenState();
    }

    function updateGenState() {
        var n = (bsFile ? 1 : 0) + (stockFile ? 1 : 0);
        manualGenBtn.disabled = n === 0;
        manualGenText.textContent = n === 0 ? '生成分析报告' : '生成分析报告 · 已选 ' + n + ' / 2';
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    function acceptSlotFile(cfg, file) {
        clearErrorManual();
        var name = (file.name || '').toLowerCase();
        var dot = name.lastIndexOf('.');
        var ext = dot >= 0 ? name.slice(dot) : '';
        if (cfg.accept.indexOf(ext) === -1) {
            showErrorManual(cfg.label + '仅支持 ' + cfg.acceptText + ' 格式文件，请重新选择。');
            return;
        }
        setSlotFile(cfg, file);
        setStatus('', '已选文件');
    }

    slotConfig.forEach(function (cfg) {
        if (!cfg.slot) return;

        cfg.slot.addEventListener('click', function (e) {
            if (e.target.closest('.slot-clear')) return;   // 清除按钮单独处理
            cfg.input.click();
        });
        cfg.slot.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                cfg.input.click();
            }
        });

        cfg.input.addEventListener('change', function (e) {
            if (e.target.files.length > 0) acceptSlotFile(cfg, e.target.files[0]);
        });

        ['dragenter', 'dragover'].forEach(function (evt) {
            cfg.slot.addEventListener(evt, function (e) {
                e.preventDefault();
                e.stopPropagation();
                cfg.slot.classList.add('dragover');
            });
        });
        ['dragleave', 'drop'].forEach(function (evt) {
            cfg.slot.addEventListener(evt, function (e) {
                e.preventDefault();
                e.stopPropagation();
                cfg.slot.classList.remove('dragover');
            });
        });
        cfg.slot.addEventListener('drop', function (e) {
            var files = e.dataTransfer.files;
            if (files.length > 0) acceptSlotFile(cfg, files[0]);
        });

        cfg.clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            setSlotFile(cfg, null);
            setStatus('', '就绪');
        });
    });

    // ── 手动上传：生成（并行上传所选文件，各自独立成败）──
    manualForm.addEventListener('submit', function (e) {
        e.preventDefault();
        generateManual();
    });

    async function generateManual() {
        clearErrorManual();
        var companyName = manualCompany.value.trim();
        if (!bsFile && !stockFile) {
            showErrorManual('请至少选择一个文件');
            return;
        }
        if (stockFile && !companyName) {
            showErrorManual('上传个股财报时必须填写公司名称');
            manualCompany.focus();
            return;
        }

        loadingBarManual.hidden = false;
        manualGenBtn.disabled = true;   // 防连点
        setStatus('loading', '解析中');

        var errors = [];
        var bsDone = false, stockDone = false;
        var bsData = null, stockData = null;

        var bsTask = bsFile ? (async function () {
            try {
                var fd = new FormData();
                fd.append('file', bsFile);
                if (companyName) fd.append('company_name', companyName);
                var resp = await fetch('/api/bs-chart', { method: 'POST', body: fd });
                var data = await resp.json();
                if (!resp.ok) throw new Error(data.detail || '解析失败');
                // bs_chart.js 暴露的渲染函数（跳过滚动，由下方统一控制定位）
                if (window.renderBsResult) window.renderBsResult(data, true, companyName);
                bsData = data;
                bsDone = true;
            } catch (err) {
                errors.push('资产负债表：' + (err.message || '网络错误'));
            }
        })() : Promise.resolve();

        var stockTask = stockFile ? (async function () {
            try {
                var fd = new FormData();
                fd.append('file', stockFile);
                fd.append('company_name', companyName);
                var resp = await fetch('/api/normalize', { method: 'POST', body: fd });
                var data = await resp.json();
                if (!resp.ok) throw new Error(data.detail || '解析失败');
                renderAllCharts(data, true);
                renderSummary(data);
                stockData = data;
                stockDone = true;
            } catch (err) {
                errors.push('个股财报：' + (err.message || '网络错误'));
            }
        })() : Promise.resolve();

        await Promise.all([bsTask, stockTask]);

        loadingBarManual.hidden = true;
        manualGenBtn.disabled = false;
        updateGenState();

        if (errors.length) {
            showErrorManual(errors.join('；'));
            return;
        }

        // 手动结果存入模式仓库并仅展示本次生成的结果区（未生成的类型隐藏）；
        // 切 tab 后由 switchToMode 按仓库数据恢复，另一 tab 生成不覆盖
        modeData.manual = {
            bs: bsDone ? bsData : null,
            bsCompany: companyName,
            stock: stockDone ? stockData : null
        };
        resultSectionBs.hidden = !bsDone || currentMode !== 'manual';
        resultSection.hidden = !stockDone || currentMode !== 'manual';
        setStatus('', '分析完成');

        // 滚动到首个结果：两个都生成时优先资产负债表（与在线模式一致）
        var target = bsDone ? resultSectionBs : resultSection;
        if (target) {
            setTimeout(function () {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    }

    // ── 手动 tab 清除：丢弃手动结果并复位表单 ──
    var clearBtnManual = document.getElementById('clearBtnManual');

    function clearManual() {
        manualCompany.value = '';
        slotConfig.forEach(function (cfg) {
            if (cfg.slot) setSlotFile(cfg, null);   // 同时复位生成按钮禁用态
        });
        errorBoxManual.hidden = true;
        loadingBarManual.hidden = true;
        modeData.manual = emptyModeState();
        // 仅清空本 tab 的结果展示；另一 tab 的数据与图表不受影响
        if (currentMode === 'manual') {
            resultSectionBs.hidden = true;
            resultSection.hidden = true;
        }
        setStatus('', '就绪');
    }

    if (clearBtnManual) clearBtnManual.addEventListener('click', clearManual);

    // ── 由标准化数据构建 6 个图表的数据包 ──────
    function buildChartPayloads(data) {
        var periods = data.periods;
        var columns = data.columns;
        var rows = data.rows;
        var company = data.company_name;

        function col(name) {
            var idx = columns.indexOf(name);
            return rows.map(function (r) {
                var v = r[idx];
                return v === null || v === undefined ? null : v / 1e8; // 元 → 亿元
            });
        }
        function ratio(name) { // 毛利率/ROE 等已是比率，不除以 1e8
            var idx = columns.indexOf(name);
            return rows.map(function (r) { return r[idx]; });
        }
        function raw(name) { // EPS（元）等原始值直取，不做单位换算
            var idx = columns.indexOf(name);
            return rows.map(function (r) {
                return r[idx] === null || r[idx] === undefined ? null : r[idx];
            });
        }

        var C = T.series;
        var axisMoney = { title: '亿元' };
        var axisPct = { title: '毛利率', unit: '%' };

        // ── ROE 年度聚合：TTM ROE + 同比增长率 ──
        var roeRaw = ratio('净资产收益率');
        // 口径标记（服务端 meta.quarterly）：true=单季值（新版在线导出），
        // false/缺失=年初至今累计值（老格式上传）
        var roeQuarterly = !!(data.meta && data.meta.quarterly);
        // 累计口径下用 滚动净利润/归母净资产 求 TTM ROE（col() 同除 1e8，比值不受影响）
        var roeTtmProfit = col('滚动净利润');
        var roeEquity = col('归母净资产');
        // 报告期(YYYY-MM-DD 季末) → 全局季度序号 qi = 年×4+(季度-1)
        function quarterIndexOf(p) {
            var m = /^(\d{4})-(\d{2})-/.exec(p);
            if (!m) return null;
            return parseInt(m[1], 10) * 4 + (Math.ceil(parseInt(m[2], 10) / 3) - 1);
        }
        var roePts = [];  // {qi, v, i}（按 periods 升序、非空，i 为期索引）
        periods.forEach(function (p, i) {
            var qi = quarterIndexOf(p);
            if (qi !== null && roeRaw[i] !== null && roeRaw[i] !== undefined) {
                roePts.push({ qi: qi, v: roeRaw[i], i: i });
            }
        });
        // 各点滚动 TTM：
        // - 单季口径：前推 3 个日历连续季度齐全才可算（4 季 ROE 求和）
        // - 累计口径：滚动净利润 / 归母净资产（年报期即全年净利润/年末净资产）。
        //   累计 ROE 值直接相加会高估数倍，不可用
        var roeTTM = roePts.map(function (pt, i) {
            if (roeQuarterly) {
                var sum = pt.v;
                for (var j = 1; j <= 3; j++) {
                    var prev = roePts[i - j];
                    if (!prev || prev.qi !== pt.qi - j) return null;
                    sum += prev.v;
                }
                return sum;
            }
            var np = roeTtmProfit[pt.i];
            var eq = roeEquity[pt.i];
            return (np !== null && np !== undefined && eq !== null && eq !== undefined && eq !== 0)
                ? np / eq : null;
        });
        // 每年取最后一个可用点的 TTM。TTM 不可算（如不完整年仅 1-3 个季度）时
        // 该年不出柱、同比留空 — 不退化为单季值冒充 TTM（会产生虚假的大幅同比下滑）
        var yearLast = {};   // 年份字符串 -> {ttm}
        roePts.forEach(function (pt, i) {
            yearLast[String(Math.floor(pt.qi / 4))] = { ttm: roeTTM[i] };
        });
        var roeYears = Object.keys(yearLast).sort();
        var roeBars = [], roeYoY = [];
        roeYears.forEach(function (y, idx) {
            var val = yearLast[y].ttm;
            roeBars.push(val);
            var prevVal = idx > 0 ? roeBars[idx - 1] : null;
            roeYoY.push(idx > 0 && prevVal && val !== null && val !== undefined
                ? (val - prevVal) / Math.abs(prevVal) : null);
        });

        // ── EPS 同比：单季 EPS 与去年同季比较 ──
        var epsRaw = raw('基本每股收益');
        var epsByQuarter = {};   // qi -> 值
        periods.forEach(function (p, i) {
            var qi = quarterIndexOf(p);
            if (qi !== null && epsRaw[i] !== null && epsRaw[i] !== undefined) {
                epsByQuarter[qi] = epsRaw[i];
            }
        });
        var epsYoY = periods.map(function (p, i) {
            var qi = quarterIndexOf(p);
            if (qi === null || epsRaw[i] === null || epsRaw[i] === undefined) return null;
            var prev = epsByQuarter[qi - 4];
            if (prev === undefined || prev === 0) return null;
            return (epsRaw[i] - prev) / Math.abs(prev);
        });

        return {
            'revenue-cashflow': {
                title: company + ' 总营收与主业现金流增长趋势',
                chart_type: 'line',
                labels: periods,
                extra: {
                    series: [
                        { name: '总营收',     data: col('总营收'),   type: 'line', color: C[0] },
                        { name: '主业现金流', data: col('主业现金流'), type: 'line', color: C[1] }
                    ],
                    scales: { left: axisMoney }
                }
            },
            'profit-cashflow-fcf': {
                title: company + ' 净利润、现金流净额与自由现金流趋势',
                chart_type: 'line',
                labels: periods,
                extra: {
                    series: [
                        { name: '净利润',        data: col('净利润'),        type: 'line', color: C[0] },
                        { name: '现金流净额',    data: col('现金流净额'),    type: 'line', color: C[1] },
                        { name: '自由现金流FCF', data: col('自由现金流FCF'), type: 'line', color: C[2] }
                    ],
                    scales: { left: axisMoney }
                }
            },
            'cost-margin': {
                title: company + ' 营业成本与毛利率分析',
                chart_type: 'mixed',
                labels: periods,
                extra: {
                    series: [
                        { name: '营业成本',   data: col('营业成本'),   type: 'bar',  color: C[0] },
                        { name: '销售毛利率', data: ratio('销售毛利率'), type: 'line', color: C[3], y_axis: 'right', unit: '%' }
                    ],
                    scales: { left: axisMoney, right: axisPct }
                }
            },
            'three-expenses': {
                title: company + ' 三费用与净利润对比',
                chart_type: 'mixed',
                labels: periods,
                extra: {
                    series: [
                        // 三条费用线用高对比色相（红/绿/橙），与靛蓝柱及白底拉开距离
                        { name: '净利润',   data: col('净利润'),   type: 'bar',  color: C[0] },
                        { name: '销售费用', data: col('销售费用'), type: 'line', color: '#dc2626' },
                        { name: '管理费用', data: col('管理费用'), type: 'line', color: '#059669' },
                        { name: '研发费用', data: col('研发费用'), type: 'line', color: '#ea580c' }
                    ],
                    scales: { left: axisMoney }
                }
            },
            'revenue-payable': {
                title: company + ' 总营收与应付票据及应付账款对比',
                chart_type: 'mixed',
                labels: periods,
                extra: {
                    series: [
                        { name: '总营收',             data: col('总营收'), type: 'bar',  color: C[0] },
                        { name: '应付票据及应付账款', data: col('应付票据及应付账款'), type: 'line', color: C[3] }
                    ],
                    scales: { left: axisMoney }
                }
            },
            'roe-growth': {
                title: company + ' ROE增长（TTM·年度）',
                chart_type: 'mixed',
                labels: roeYears,
                extra: {
                    series: [
                        { name: 'TTM ROE',    data: roeBars, type: 'bar',  color: C[0], unit: '%' },
                        { name: '同比增长率', data: roeYoY,  type: 'line', color: C[3], y_axis: 'right', unit: '%' }
                    ],
                    scales: {
                        left: { title: 'TTM ROE', unit: '%' },
                        right: { title: '同比增长率', unit: '%' }
                    }
                }
            },
            'eps-growth': {
                title: company + ' EPS增长（单季度）',
                chart_type: 'mixed',
                labels: periods,
                extra: {
                    series: [
                        { name: '单季EPS',    data: epsRaw, type: 'bar',  color: C[0], unit: '元' },
                        { name: '同比增长率', data: epsYoY, type: 'line', color: C[3], y_axis: 'right', unit: '%' }
                    ],
                    scales: {
                        left: { title: 'EPS（元/股）', unit: '元' },
                        right: { title: '同比增长率', unit: '%' }
                    }
                }
            }
        };
    }

    // ── 渲染图表（ROE/EPS 等列缺失时对应卡片自动隐藏）──
    function renderAllCharts(data, skipScroll) {
        resultSection.hidden = false;
        chartSub.textContent = '公司：' + data.company_name;

        Object.keys(chartInstances).forEach(function (key) {
            if (chartInstances[key]) {
                chartInstances[key].destroy();
                delete chartInstances[key];
            }
        });

        var payloads = buildChartPayloads(data);

        CHART_DEFS.forEach(function (def) {
            var payload = payloads[def.name];
            var titleEl = document.getElementById('title-' + def.name);
            var canvas = document.getElementById('canvas-' + def.name);
            var card = document.querySelector('.stock-chart-card[data-chart="' + def.name + '"]');

            // 全空数据（老格式文件缺 ROE/EPS 行）→ 隐藏卡片，不进缓存/全屏循环
            var hasData = payload && (payload.extra && payload.extra.series || []).some(function (s) {
                return (s.data || []).some(function (v) { return v !== null && v !== undefined; });
            });
            if (!hasData) {
                if (card) card.style.display = 'none';
                delete chartDataCache[def.name];
                return;
            }
            if (card) card.style.display = '';

            titleEl.textContent = payload.title;
            renderChart(canvas, payload, def.name);
            chartDataCache[def.name] = payload;
        });

        if (!skipScroll) {
            setTimeout(function () {
                resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    }

    // ── Chart.js 渲染（line / mixed，主题化）─────
    function renderChart(canvas, chartData, chartName, enableZoom) {
        if (window.ChartDataLabels) Chart.register(ChartDataLabels);
        if (window.ChartZoom) Chart.register(ChartZoom);

        var labels = chartData.labels || [];
        var extra = chartData.extra || {};
        var series = extra.series || [];
        var scales = extra.scales || {};
        var chartType = chartData.chart_type || 'line';

        var datasets = series.map(function (s) {
            var ds = {
                label: s.name,
                data: s.data,
                borderColor: s.color,
                backgroundColor: s.type === 'bar' ? s.color : hexToRgba(s.color, 0.1),
                borderWidth: s.type === 'bar' ? 0 : 2,
                tension: 0.35,
                fill: false,
                pointRadius: s.type === 'line' ? 0 : undefined,
                pointHoverRadius: s.type === 'line' ? 5 : undefined,
                pointBackgroundColor: s.color,
                pointBorderColor: T.pointBorder,
                pointBorderWidth: 1.5,
                yAxisID: s.y_axis === 'right' ? 'yRight' : 'yLeft',
                type: s.type,
                order: s.type === 'bar' ? 2 : 1
            };
            if (s.type === 'bar') {
                ds.borderRadius = T.barRadius;
                ds.maxBarThickness = 28;
            }
            return ds;
        });

        var chartScales = {
            x: {
                ticks: {
                    color: T.textMute,
                    font: { size: 10, family: T.font },
                    autoSkip: !enableZoom,
                    maxTicksLimit: enableZoom ? 60 : 12,
                    maxRotation: 60,
                    minRotation: 45,
                    padding: 4,
                    callback: function (value) {
                        var label = this.getLabelForValue(value);
                        var m = /-(\d{2})-/.exec(label);
                        if (m) {
                            // 报告期为季末日期（03-31=Q1、06-30=Q2、09-30=Q3、12-31=Q4），
                            // 用 ceil 换算季度，避免 Q1 被标成 Q2、Q4 被标成 Q5
                            var q = Math.ceil(parseInt(m[1], 10) / 3);
                            return label.substring(0, 4) + '-Q' + q;
                        }
                        return label;
                    }
                },
                grid: { display: false },
                border: { color: T.axisBorder, width: 1 }
            }
        };

        var leftScale = scales.left || {};
        chartScales.yLeft = {
            position: 'left',
            beginAtZero: true,
            title: {
                display: !!leftScale.title,
                text: leftScale.title || '',
                color: T.text,
                font: { size: 11, family: T.font }
            },
            ticks: {
                color: T.textMute,
                font: { size: 11, family: T.font },
                callback: function (v) {
                    return leftScale.unit === '%' ? (v * 100).toFixed(0) + '%' : v.toFixed(1);
                }
            },
            grid: { color: T.grid, drawTicks: false },
            border: { display: false }
        };

        if (scales.right) {
            chartScales.yRight = {
                position: 'right',
                beginAtZero: true,
                title: {
                    display: !!scales.right.title,
                    text: scales.right.title || '',
                    color: T.text,
                    font: { size: 11, family: T.font }
                },
                ticks: {
                    color: T.textMute,
                    font: { size: 11, family: T.font },
                    callback: function (v) {
                        return scales.right.unit === '%' ? (v * 100).toFixed(0) + '%' : v.toFixed(1);
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
                layout: { padding: { top: 16, right: 16, bottom: 4, left: 4 } },
                animation: { duration: 700, easing: 'easeOutQuart' },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'end',
                        labels: {
                            color: T.text,
                            font: { size: 11, family: T.font },
                            boxWidth: 14,
                            boxHeight: 8,
                            padding: 14,
                            usePointStyle: true
                        }
                    },
                    tooltip: {
                        backgroundColor: T.tooltipBg,
                        borderColor: T.tooltipBorder,
                        borderWidth: 1,
                        padding: 12,
                        titleColor: T.tooltipFg,
                        bodyColor: T.tooltipFg,
                        titleFont: { size: 12, family: T.font, weight: '600' },
                        bodyFont: { size: 12, family: T.font },
                        displayColors: true,
                        boxWidth: 10,
                        boxHeight: 10,
                        callbacks: {
                            label: function (c) {
                                var val = c.parsed.y;
                                if (val === null || val === undefined) return null;
                                var s = series[c.datasetIndex];
                                if (s && s.unit === '%') {
                                    return c.dataset.label + ': ' + (val * 100).toFixed(2) + '%';
                                }
                                if (s && s.unit === '元') {
                                    return c.dataset.label + ': ' + val.toFixed(2) + ' 元';
                                }
                                return c.dataset.label + ': ' + val.toFixed(3) + ' 亿元';
                            }
                        }
                    },
                    datalabels: { display: false },
                    zoom: enableZoom ? {
                        pan: { enabled: true, mode: 'xy', modifierKey: null },
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

        if (!enableZoom) chartInstances[chartName] = instance;
        return instance;
    }

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
        sumRange.textContent = periods.length ? (periods[0] + ' ~ ' + periods[periods.length - 1]) : '—';
        sumColumns.textContent = (data.columns || []).length + ' 列';
        sumSource.textContent = data.source_file || '—';
        jsonContent.textContent = JSON.stringify(data, null, 2);
    }

    // ── JSON 折叠 ─────────────────────────────
    jsonToggle.addEventListener('toggle', function () {
        jsonContent.hidden = !jsonToggle.open;
    });

    // ── 全屏放大 ──────────────────────────────
    var fullscreenCurrentName = null;   // 当前全屏展示的图表名（用于方向键切换）

    function openFullscreen(chartName) {
        var chartData = chartDataCache[chartName];
        if (!chartData) return;

        fullscreenCurrentName = chartName;

        if (fullscreenChart) {
            fullscreenChart.destroy();
            fullscreenChart = null;
        }

        fullscreenTitle.textContent = chartData.title;
        fullscreenOverlay.hidden = false;
        document.body.style.overflow = 'hidden';

        requestAnimationFrame(function () {
            fullscreenChart = renderChart(fullscreenCanvas, chartData, chartName, true);
        });
    }

    // 方向键 / 翻页键在全屏中切换上一张 / 下一张图表（循环回绕）
    // 可切换集合 = 当前有数据（已缓存）的图表，隐藏的空卡片不参与循环
    function switchFullscreen(step) {
        if (fullscreenOverlay.hidden || !fullscreenCurrentName) return;
        var order = CHART_DEFS.map(function (d) { return d.name; })
            .filter(function (n) { return !!chartDataCache[n]; });
        var idx = order.indexOf(fullscreenCurrentName);
        if (idx < 0) return;
        openFullscreen(order[(idx + step + order.length) % order.length]);
    }

    function closeFullscreen() {
        fullscreenOverlay.hidden = true;
        fullscreenCurrentName = null;
        document.body.style.overflow = '';
        if (fullscreenChart) {
            fullscreenChart.destroy();
            fullscreenChart = null;
        }
    }

    document.querySelectorAll('.stock-chart-card .btn-zoom').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var card = btn.closest('.stock-chart-card');
            openFullscreen(card.getAttribute('data-chart'));
        });
    });

    btnCloseFullscreen.addEventListener('click', closeFullscreen);
    btnResetZoom.addEventListener('click', function () {
        if (fullscreenChart) fullscreenChart.resetZoom();
    });

    fullscreenOverlay.addEventListener('click', function (e) {
        if (e.target === fullscreenOverlay) closeFullscreen();
    });

    // 全屏中的键盘交互：ESC 关闭，←/→ 或 PgUp/PgDn 切换上一张/下一张图表
    document.addEventListener('keydown', function (e) {
        if (fullscreenOverlay.hidden) return;
        if (e.key === 'Escape') {
            closeFullscreen();
        } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
            e.preventDefault();
            switchFullscreen(1);
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
            e.preventDefault();
            switchFullscreen(-1);
        }
    });

    // ── 在线获取：一次 code 生成两套报告 ─────
    var codeInput = document.getElementById('codeInput');
    var fetchBtn = document.getElementById('fetchBtn');
    var errorBoxOnline = document.getElementById('errorBoxOnline');
    var loadingBarOnline = document.getElementById('loadingBarOnline');

    function showErrorOnline(msg) {
        errorBoxOnline.hidden = false;
        errorBoxOnline.textContent = '⚠ ' + msg;
        setStatus('error', '错误');
    }

    async function fetchAllByCode() {
        var code = (codeInput.value || '').trim();
        if (!/^\d{6}$/.test(code)) {
            showErrorOnline('请输入 6 位数字股票代码');
            codeInput.focus();
            return;
        }

        errorBoxOnline.hidden = true;
        loadingBarOnline.hidden = false;
        fetchBtn.disabled = true;   // 防连点：后端对同花顺请求有全局限流
        setStatus('loading', '获取中');

        try {
            var resp = await fetch('/api/fetch-all?code=' + encodeURIComponent(code), { method: 'POST' });
            var data = await resp.json();
            if (!resp.ok) throw new Error(data.detail || '获取失败');

            // 个股财报 6 张图 + 数据摘要
            renderAllCharts(data.stock);
            renderSummary(data.stock);
            // 资产负债表优先展示（bs_chart.js 暴露的渲染函数，公司名由在线结果传入）
            if (window.renderBsResult) window.renderBsResult(data.bs, true, data.company_name);
            // 在线结果存入模式仓库：切换 tab 后可完整恢复，另一 tab 生成不覆盖
            modeData.online = { bs: data.bs, bsCompany: data.company_name, stock: data.stock };
            setStatus('', '分析完成');

            // 生成期间用户已切到另一 tab：数据只入库不显示，切回时由 switchToMode 渲染
            if (currentMode !== 'online') {
                resultSectionBs.hidden = true;
                resultSection.hidden = true;
                return;
            }

            // 滚动到资产负债表区块：生成后第一眼看到资产表
            setTimeout(function () {
                resultSectionBs.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        } catch (err) {
            showErrorOnline(err.message || '网络错误，请重试');
        } finally {
            loadingBarOnline.hidden = true;
            fetchBtn.disabled = false;
        }
    }

    fetchBtn.addEventListener('click', fetchAllByCode);
    codeInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') fetchAllByCode();
    });

    // ── 在线 tab 清除：丢弃在线结果并复位表单 ──
    var clearBtnOnline = document.getElementById('clearBtnOnline');

    function clearOnline() {
        codeInput.value = '';
        errorBoxOnline.hidden = true;
        loadingBarOnline.hidden = true;
        modeData.online = emptyModeState();
        // 仅清空本 tab 的结果展示；另一 tab 的数据与图表不受影响
        if (currentMode === 'online') {
            resultSectionBs.hidden = true;
            resultSection.hidden = true;
        }
        setStatus('', '就绪');
    }

    if (clearBtnOnline) clearBtnOnline.addEventListener('click', clearOnline);

    // ── 深链接：#stock / #bs 平滑滚动到对应区块 ──
    function scrollToHash() {
        var h = (location.hash || '').replace('#', '');
        var el = null;
        if (h === 'stock' && resultSection && !resultSection.hidden) el = resultSection;
        if (h === 'bs' && resultSectionBs && !resultSectionBs.hidden) el = resultSectionBs;
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    scrollToHash();
    window.addEventListener('hashchange', scrollToHash);

})();
