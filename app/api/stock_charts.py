"""6 个业务图表路由

GET /api/charts/{name}?data_id=xxx
    按 data_id 从 data_store 取标准化数据，调用 finance.stock_charts 对应函数，
    返回 ChartResponse。前端上传后并发请求 6 个端点渲染图表。

路由名与 finance.stock_charts.CHART_FUNCS 的 key 对齐：
    - revenue-cashflow      总营收与主业现金流增长趋势
    - profit-cashflow-fcf   净利润、现金流净额、自由现金流趋势
    - cost-margin           成本与毛利率分析（mixed）
    - three-expenses        三费用与业绩对比（mixed）
    - revenue-payable       总营收与应付账款对比（mixed）
    - rd-profit             研发费用与净利润趋势
"""

from fastapi import APIRouter, HTTPException, Query

from app.schemas.chart import ChartResponse
from app.services.data_store import get as store_get
from finance.stock_charts import CHART_FUNCS


router = APIRouter(prefix="/api/charts", tags=["业务图表"])


def _build_chart(chart_name: str, data_id: str) -> ChartResponse:
    """通用图表构建逻辑：取缓存数据 → 调对应算法函数 → 返回 ChartResponse。

    Args:
        chart_name: 路由名（CHART_FUNCS 的 key）
        data_id:    标准化数据缓存 ID

    Raises:
        HTTPException: data_id 不存在或 chart_name 不支持
    """
    entry = store_get(data_id)
    if entry is None:
        raise HTTPException(
            status_code=404,
            detail=f"data_id 不存在或已过期：{data_id}。请重新上传文件。",
        )

    chart_func = CHART_FUNCS.get(chart_name)
    if chart_func is None:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的图表类型：{chart_name}",
        )

    # 调用算法层函数，传入 NormalizedData 和公司名
    return chart_func(entry.data, entry.company_name)


@router.get("/revenue-cashflow", response_model=ChartResponse)
async def revenue_cashflow_chart(
    data_id: str = Query(..., description="标准化数据缓存 ID（由 POST /api/normalize 返回）"),
) -> ChartResponse:
    """图1：{公司}总营收与主业现金流增长趋势图（line 双线，滚动值）"""
    return _build_chart("revenue-cashflow", data_id)


@router.get("/profit-cashflow-fcf", response_model=ChartResponse)
async def profit_cashflow_fcf_chart(
    data_id: str = Query(..., description="标准化数据缓存 ID"),
) -> ChartResponse:
    """图2：{公司}净利润、现金流净额、自由现金流趋势图（line 三线）"""
    return _build_chart("profit-cashflow-fcf", data_id)


@router.get("/cost-margin", response_model=ChartResponse)
async def cost_margin_chart(
    data_id: str = Query(..., description="标准化数据缓存 ID"),
) -> ChartResponse:
    """图3：{公司}成本与毛利率分析（mixed：柱+折线双轴）"""
    return _build_chart("cost-margin", data_id)


@router.get("/three-expenses", response_model=ChartResponse)
async def three_expenses_chart(
    data_id: str = Query(..., description="标准化数据缓存 ID"),
) -> ChartResponse:
    """图4：{公司}三费用与业绩对比分析（mixed：柱+折线双轴）"""
    return _build_chart("three-expenses", data_id)


@router.get("/revenue-payable", response_model=ChartResponse)
async def revenue_payable_chart(
    data_id: str = Query(..., description="标准化数据缓存 ID"),
) -> ChartResponse:
    """图5：{公司}总营收与应付账款对比（mixed：柱+折线双轴）"""
    return _build_chart("revenue-payable", data_id)


@router.get("/rd-profit", response_model=ChartResponse)
async def rd_profit_chart(
    data_id: str = Query(..., description="标准化数据缓存 ID"),
) -> ChartResponse:
    """图6：{公司}研发费用与净利润趋势图（line 双线，单期值）"""
    return _build_chart("rd-profit", data_id)
