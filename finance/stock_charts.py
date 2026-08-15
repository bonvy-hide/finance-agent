"""个股财报 6 个业务图表算法模块（纯业务逻辑，无 Web 依赖）。

每个函数接收 NormalizedData（来自 finance.stock_normalize.normalize）和公司名，
返回 ChartResponse（来自 app.schemas.chart）。算法层不直接处理 HTTP，仅产出数据结构。

设计原则：
    - 不 import 任何 FastAPI / HTTP 模块（四层架构约定）
    - 底层数值保留 float（元），输出时按指标自适应单位：
        * 金额类 → 亿元（÷1e8）
        * 毛利率 → 保持小数（如 0.3005）
    - 缺失值（None）保留，前端渲染时断点跳过

6 个图表对应关系：
    1. revenue_cashflow_trend        - 总营收与主业现金流增长趋势（line 双线，滚动值）
    2. profit_cashflow_fcf_trend     - 净利润、现金流净额、自由现金流趋势（line 三线）
    3. cost_margin_analysis          - 成本与毛利率分析（mixed：柱+折线双轴）
    4. three_expenses_comparison     - 三费用与业绩对比（mixed：柱+折线双轴）
    5. revenue_payable_comparison    - 总营收与应付账款对比（mixed：柱+折线双轴）
    6. rd_profit_trend               - 研发费用与净利润趋势（line 双线，单期值）
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.schemas.chart import ChartResponse
from finance.stock_normalize import NormalizedData


# ---------------------------------------------------------------------------
# 常量：单位转换与配色
# ---------------------------------------------------------------------------

# 元 → 亿元
_YI_DIVISOR = 1e8

# 标准化数据中 OUTPUT_COLUMNS 各列的索引（与 finance.stock_normalize.OUTPUT_COLUMNS 对齐）
# 首列 "科目\时间" 为 0，其余依次 +1
_COL = {
    "period": 0,
    "滚动总营收": 1,
    "滚动现金流": 2,
    "滚动净利润": 3,
    "滚动现金流净额": 4,
    "归母净资产": 5,
    "总营收": 6,
    "主业现金流": 7,
    "净利润": 8,
    "现金流净额": 9,
    "自由现金流FCF": 10,
    "营业成本": 11,
    "销售毛利率": 12,
    "销售费用": 13,
    "管理费用": 14,
    "研发费用": 15,
    "应付票据及应付账款": 16,
}

# 配色方案（深色金融仪表盘风格，与项目现有 chart 配色统一）
# 柱状用沉稳色，折线用对比色
COLOR_BAR_PRIMARY = "#7a9070"      # 暗绿（主柱）
COLOR_BAR_SECONDARY = "#b8956a"    # 暗金（次柱）
COLOR_LINE_REVENUE = "#7a9070"     # 暗绿（营收线）
COLOR_LINE_CASHFLOW = "#5e9bd8"    # 钢蓝（现金流线）
COLOR_LINE_PROFIT = "#d8a657"      # 暗金（净利润线）
COLOR_LINE_OCF = "#5e9bd8"         # 钢蓝（经营现金流净额线）
COLOR_LINE_FCF = "#c45a5a"         # 暗红（自由现金流线）
COLOR_LINE_MARGIN = "#d8a657"      # 暗金（毛利率线）
COLOR_LINE_EXPENSE = "#c45a5a"     # 暗红（费用线，统一色，遗留兼容）
COLOR_LINE_PAYABLE = "#b8956a"     # 暗金（应付账款线）
COLOR_LINE_RD = "#c45a5a"          # 暗红（研发费用线，遗留兼容）
# 三费用专用色（销售/管理/研发各一色，便于区分）
COLOR_LINE_SALES_EXP = "#5e9bd8"   # 钢蓝（销售费用线）
COLOR_LINE_ADMIN_EXP = "#9b6dbd"   # 紫罗兰（管理费用线，与柱状绿/暗红明显区分）
COLOR_LINE_RD_EXP = "#c45a5a"      # 暗红（研发费用线）

UNIT_YI = "亿"
UNIT_PERCENT = "%"


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------


def _extract_column(data: NormalizedData, col_name: str) -> List[Optional[float]]:
    """从 NormalizedData 提取指定列的值列表（与 periods 等长）。

    Args:
        data:     normalize() 返回的标准化数据
        col_name: OUTPUT_COLUMNS 中的列名（不含首列 "科目\\时间"）

    Returns:
        该列所有期的值列表，缺失为 None
    """
    idx = _COL.get(col_name)
    if idx is None:
        raise KeyError(f"未知列名：{col_name}")
    return [row[idx] if idx < len(row) else None for row in data["rows"]]


def _to_yi(values: List[Optional[float]]) -> List[Optional[float]]:
    """把金额（元）列表转为亿元列表，None 保留。"""
    return [v / _YI_DIVISOR if v is not None else None for v in values]


def _keep_raw(values: List[Optional[float]]) -> List[Optional[float]]:
    """保持原值（毛利率等已是小数），None 保留。返回副本避免外部修改。"""
    return list(values)


def _build_line_series(
    name: str,
    data: List[Optional[float]],
    color: str,
    unit: str = UNIT_YI,
) -> Dict[str, Any]:
    """构造 line 类型的 series 项（用于 extra.series）。"""
    return {
        "name": name,
        "type": "line",
        "y_axis": "left",  # line 类型默认左轴，路由层可按需调整
        "data": data,
        "color": color,
        "unit": unit,
    }


def _build_bar_series(
    name: str,
    data: List[Optional[float]],
    color: str,
    y_axis: str = "left",
    unit: str = UNIT_YI,
) -> Dict[str, Any]:
    """构造 bar 类型的 series 项（用于 extra.series）。"""
    return {
        "name": name,
        "type": "bar",
        "y_axis": y_axis,
        "data": data,
        "color": color,
        "unit": unit,
    }


def _build_mixed_series_item(
    name: str,
    series_type: str,
    y_axis: str,
    data: List[Optional[float]],
    color: str,
    unit: str,
) -> Dict[str, Any]:
    """构造 mixed 图表的 series 项（显式指定 y_axis）。"""
    return {
        "name": name,
        "type": series_type,
        "y_axis": y_axis,
        "data": data,
        "color": color,
        "unit": unit,
    }


# ---------------------------------------------------------------------------
# 6 个图表算法函数
# ---------------------------------------------------------------------------


def revenue_cashflow_trend(data: NormalizedData, company: str) -> ChartResponse:
    """图1：{公司}总营收与主业现金流增长趋势图（line 双线，滚动值）。

    数据列：
        - 滚动总营收（滚动 TTM）
        - 滚动现金流（滚动 TTM，销售商品提供劳务收到的现金）
    单位：亿元
    """
    labels = list(data["periods"])
    revenue = _to_yi(_extract_column(data, "滚动总营收"))
    cashflow = _to_yi(_extract_column(data, "滚动现金流"))

    series = [
        _build_line_series("滚动总营收", revenue, COLOR_LINE_REVENUE),
        _build_line_series("滚动现金流", cashflow, COLOR_LINE_CASHFLOW),
    ]

    return ChartResponse(
        period=labels[-1] if labels else "",
        title=f"{company}总营收与主业现金流增长趋势图",
        chart_type="line",
        labels=labels,
        values=revenue,  # 主序列（向后兼容）
        total=sum(v for v in revenue if v is not None),
        groups={},
        extra={
            "series": series,
            "scales": {
                "left": {"title": "金额（亿元）", "unit": UNIT_YI},
            },
            "unit": UNIT_YI,
        },
    )


def profit_cashflow_fcf_trend(data: NormalizedData, company: str) -> ChartResponse:
    """图2：{公司}净利润、现金流净额、自由现金流趋势图（line 三线）。

    数据列：
        - 滚动净利润（滚动 TTM）
        - 滚动现金流净额（滚动 TTM，经营活动现金流量净额）
        - 自由现金流FCF（单期累计值，非滚动）
    单位：亿元
    """
    labels = list(data["periods"])
    profit = _to_yi(_extract_column(data, "滚动净利润"))
    ocf = _to_yi(_extract_column(data, "滚动现金流净额"))
    fcf = _to_yi(_extract_column(data, "自由现金流FCF"))

    series = [
        _build_line_series("滚动净利润", profit, COLOR_LINE_PROFIT),
        _build_line_series("滚动现金流净额", ocf, COLOR_LINE_OCF),
        _build_line_series("自由现金流FCF", fcf, COLOR_LINE_FCF),
    ]

    return ChartResponse(
        period=labels[-1] if labels else "",
        title=f"{company}净利润、现金流净额、自由现金流趋势图",
        chart_type="line",
        labels=labels,
        values=profit,
        total=sum(v for v in profit if v is not None),
        groups={},
        extra={
            "series": series,
            "scales": {
                "left": {"title": "金额（亿元）", "unit": UNIT_YI},
            },
            "unit": UNIT_YI,
        },
    )


def cost_margin_analysis(data: NormalizedData, company: str) -> ChartResponse:
    """图3：{公司}成本与毛利率分析（mixed：柱+折线双轴）。

    数据列：
        - 总营收（单期累计值，柱，左轴，亿元）
        - 营业成本（单期累计值，柱，左轴，亿元）
        - 销售毛利率（小数，折线，右轴，百分比）
    """
    labels = list(data["periods"])
    revenue = _to_yi(_extract_column(data, "总营收"))
    cost = _to_yi(_extract_column(data, "营业成本"))
    margin = _keep_raw(_extract_column(data, "销售毛利率"))

    series = [
        _build_mixed_series_item("总营收", "bar", "left", revenue, COLOR_BAR_PRIMARY, UNIT_YI),
        _build_mixed_series_item("营业成本", "bar", "left", cost, COLOR_BAR_SECONDARY, UNIT_YI),
        _build_mixed_series_item("销售毛利率", "line", "right", margin, COLOR_LINE_MARGIN, UNIT_PERCENT),
    ]

    return ChartResponse(
        period=labels[-1] if labels else "",
        title=f"{company}成本与毛利率分析",
        chart_type="mixed",
        labels=labels,
        values=revenue,
        total=sum(v for v in revenue if v is not None),
        groups={},
        extra={
            "series": series,
            "scales": {
                "left": {"title": "金额（亿元）", "unit": UNIT_YI},
                "right": {"title": "毛利率", "unit": UNIT_PERCENT},
            },
            "unit": UNIT_YI,
        },
    )


def three_expenses_comparison(data: NormalizedData, company: str) -> ChartResponse:
    """图4：{公司}三费用与业绩对比分析（mixed：柱+折线双轴）。

    数据列：
        - 总营收（单期累计值，柱，右轴，亿元）
        - 销售费用（单期累计值，折线，左轴，亿元）
        - 管理费用（单期累计值，折线，左轴，亿元）
        - 研发费用（单期累计值，折线，左轴，亿元）

    说明：总营收金额远大于三费用，放右轴；三费用折线放左轴便于观察趋势。
    """
    labels = list(data["periods"])
    revenue = _to_yi(_extract_column(data, "总营收"))
    sales_exp = _to_yi(_extract_column(data, "销售费用"))
    admin_exp = _to_yi(_extract_column(data, "管理费用"))
    rd_exp = _to_yi(_extract_column(data, "研发费用"))

    series = [
        _build_mixed_series_item("总营收", "bar", "right", revenue, COLOR_BAR_PRIMARY, UNIT_YI),
        _build_mixed_series_item("销售费用", "line", "left", sales_exp, COLOR_LINE_SALES_EXP, UNIT_YI),
        _build_mixed_series_item("管理费用", "line", "left", admin_exp, COLOR_LINE_ADMIN_EXP, UNIT_YI),
        _build_mixed_series_item("研发费用", "line", "left", rd_exp, COLOR_LINE_RD_EXP, UNIT_YI),
    ]

    return ChartResponse(
        period=labels[-1] if labels else "",
        title=f"{company}三费用与业绩对比分析",
        chart_type="mixed",
        labels=labels,
        values=revenue,
        total=sum(v for v in revenue if v is not None),
        groups={},
        extra={
            "series": series,
            "scales": {
                "left": {"title": "费用（亿元）", "unit": UNIT_YI},
                "right": {"title": "总营收（亿元）", "unit": UNIT_YI},
            },
            "unit": UNIT_YI,
        },
    )


def revenue_payable_comparison(data: NormalizedData, company: str) -> ChartResponse:
    """图5：{公司}总营收与应付账款对比（mixed：柱+折线双轴）。

    数据列：
        - 总营收（单期累计值，柱，左轴，亿元）
        - 应付票据及应付账款（单期时点值，折线，右轴，亿元）

    说明：两者数量级可能差异较大，分置左右轴便于对比趋势。
    """
    labels = list(data["periods"])
    revenue = _to_yi(_extract_column(data, "总营收"))
    payable = _to_yi(_extract_column(data, "应付票据及应付账款"))

    series = [
        _build_mixed_series_item("总营收", "bar", "left", revenue, COLOR_BAR_PRIMARY, UNIT_YI),
        _build_mixed_series_item("应付票据及应付账款", "line", "right", payable, COLOR_LINE_PAYABLE, UNIT_YI),
    ]

    return ChartResponse(
        period=labels[-1] if labels else "",
        title=f"{company}总营收与应付账款对比",
        chart_type="mixed",
        labels=labels,
        values=revenue,
        total=sum(v for v in revenue if v is not None),
        groups={},
        extra={
            "series": series,
            "scales": {
                "left": {"title": "总营收（亿元）", "unit": UNIT_YI},
                "right": {"title": "应付账款（亿元）", "unit": UNIT_YI},
            },
            "unit": UNIT_YI,
        },
    )


def rd_profit_trend(data: NormalizedData, company: str) -> ChartResponse:
    """图6：{公司}研发费用与净利润对比分析（mixed：柱+折线双轴）。

    数据列：
        - 研发费用（单期累计值，柱，左轴，亿元）
        - 净利润（单期累计值，柱，左轴，亿元）
        - 研发费用 / 净利润 比例（小数，折线，右轴，百分比，反映 R&D 投入强度）

    说明：
        - 双柱同左轴便于直接对比金额规模
        - 比例折线在右轴，反映研发对净利润的相对投入强度
        - 净利润为负或零时，比例置为 None（无意义）
    """
    labels = list(data["periods"])
    rd = _to_yi(_extract_column(data, "研发费用"))
    profit = _to_yi(_extract_column(data, "净利润"))

    # 计算 研发费用 / 净利润 比例（小数形式）
    ratio: List[Optional[float]] = []
    for r, p in zip(rd, profit):
        if r is None or p is None or p <= 0:
            ratio.append(None)
        else:
            ratio.append(r / p)

    series = [
        _build_mixed_series_item("研发费用", "bar", "left", rd, COLOR_LINE_RD_EXP, UNIT_YI),
        _build_mixed_series_item("净利润", "bar", "left", profit, COLOR_LINE_PROFIT, UNIT_YI),
        _build_mixed_series_item("研发费用占净利润比例", "line", "right", ratio, COLOR_LINE_PAYABLE, UNIT_PERCENT),
    ]

    return ChartResponse(
        period=labels[-1] if labels else "",
        title=f"{company}研发费用与净利润对比分析",
        chart_type="mixed",
        labels=labels,
        values=rd,
        total=sum(v for v in rd if v is not None),
        groups={},
        extra={
            "series": series,
            "scales": {
                "left": {"title": "金额（亿元）", "unit": UNIT_YI},
                "right": {"title": "占比", "unit": UNIT_PERCENT},
            },
            "unit": UNIT_YI,
        },
    )


# ---------------------------------------------------------------------------
# 图表注册表：路由层按名称查找对应函数
# ---------------------------------------------------------------------------

# 路由名 → 图表函数（供 app/api/stock_charts.py 路由层调用）
CHART_FUNCS: Dict[str, Any] = {
    "revenue-cashflow": revenue_cashflow_trend,
    "profit-cashflow-fcf": profit_cashflow_fcf_trend,
    "cost-margin": cost_margin_analysis,
    "three-expenses": three_expenses_comparison,
    "revenue-payable": revenue_payable_comparison,
    "rd-profit": rd_profit_trend,
}


__all__ = [
    "revenue_cashflow_trend",
    "profit_cashflow_fcf_trend",
    "cost_margin_analysis",
    "three_expenses_comparison",
    "revenue_payable_comparison",
    "rd_profit_trend",
    "CHART_FUNCS",
]
