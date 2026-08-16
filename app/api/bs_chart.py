"""资产负债结构图路由"""

from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile, HTTPException

from app.schemas.chart import ChartResponse
from app.services.excel_parser import save_upload, cleanup
from finance.bs_chart import (
    DEFAULT_RULES,
    LABELS,
    apply_rules,
    read_bs,
)

router = APIRouter(prefix="/api", tags=["资产负债结构"])

# 资产项数量（前 9 项为资产，后 7 项为负债）
ASSET_COUNT = 9


def build_bs_chart_response(path: Path, fallback_name: str = "") -> ChartResponse:
    """解析资产负债表 Excel 并组装 ChartResponse（16 项分组，单位亿元）。

    供上传端点与同花顺在线获取端点共用。
    fallback_name：报告期缺失时用作 period 兜底（如股票名/文件名）。
    抛出的异常由调用方转 HTTP 错误。
    """
    # 解析 Excel
    bs = read_bs(path, unit_hint="元")

    # 应用合并规则
    values = apply_rules(bs, DEFAULT_RULES)
    period = str(bs.get("报告期") or "") or fallback_name or "未知报告期"

    # 转为亿元
    groups_yi = {k: round(v / 1e8, 4) for k, v in values.items()}
    vals_yi = [groups_yi.get(k, 0) for k in LABELS]
    total = round(sum(vals_yi), 4)

    return ChartResponse(
        period=period,
        title="资产负债结构",
        chart_type="bar",
        labels=LABELS,
        values=vals_yi,
        total=total,
        groups=groups_yi,
        extra={
            "asset_count": ASSET_COUNT,
            "raw_rows_count": len(bs.get("rows", [])),
        },
    )


@router.post("/bs-chart", response_model=ChartResponse)
async def chart(
    file: UploadFile = File(...),
    company_name: str = Form("", description="公司名称（选填，报告期缺失时用作标注）"),
) -> ChartResponse:
    """上传资产负债表 Excel，返回 16 项分组数据。

    返回结构见 ChartResponse，chart_type 固定为 bar，
    extra 中附带 asset_count（资产/负债分界索引）和 raw_rows_count。
    """
    tmp_path, filename = await save_upload(file)
    try:
        # 报告期兜底优先级：Excel 内报告期 > 公司名称 > 文件名
        fallback = company_name.strip() or Path(filename).stem
        try:
            return build_bs_chart_response(tmp_path, fallback_name=fallback)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Excel 解析失败：{e}")
    finally:
        cleanup(tmp_path)
