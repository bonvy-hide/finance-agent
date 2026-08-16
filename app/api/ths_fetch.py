"""同花顺在线获取路由：一次输入 code，同时生成两套分析数据"""

import re

from fastapi import APIRouter, HTTPException, Query

from app.api.bs_chart import build_bs_chart_response
from app.schemas.chart import FetchAllResponse, NormalizeResponse
from app.services import ths_client
from app.services.data_store import put as store_put
from finance.stock_normalize import normalize

router = APIRouter(prefix="/api", tags=["同花顺在线获取"])

# 6 位数字股票代码（沪/深/创业板/科创板通用）
CODE_PATTERN = re.compile(r"\d{6}")


@router.post("/fetch-all", response_model=FetchAllResponse)
async def fetch_all(
    code: str = Query(..., description="6 位股票代码，如 688008、300750"),
) -> FetchAllResponse:
    """输入一次股票代码，自动从同花顺下载个股财报与资产负债表并解析。

    流程：结果缓存 → 名称反查（缓存）→ 下载 diy.xls → 标准化 →
    下载 debt.xls → 16 项分组 → 组装返回。
    外部请求经全局限流（最小间隔 THS_MIN_INTERVAL），频繁请求返回 429。
    """
    code = code.strip()
    if not CODE_PATTERN.fullmatch(code):
        raise HTTPException(status_code=400, detail="股票代码须为 6 位数字")

    # 1) 命中结果缓存：不发起任何外部请求
    cached = ths_client.get_cached_result(code)
    if cached is not None:
        return cached.model_copy(update={"cached": True})

    try:
        # 2) 反查股票名称（失败时回退为 code）
        name = await ths_client.fetch_stock_name(code)

        # 3) 下载并解析个股财报（diy_report 模板）
        diy_path = await ths_client.download_diy_xls(code)
        try:
            data = normalize(diy_path)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"个股财报解析失败：{e}")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"个股财报读取失败：{e}")
        finally:
            diy_path.unlink(missing_ok=True)

        data_id = store_put(
            data=data,
            company_name=name,
            source_file=f"{name}({code})_diy_report.xls",
        )
        stock_resp = NormalizeResponse(
            data_id=data_id,
            company_name=name,
            source_file=f"{name}({code})_diy_report.xls",
            periods=list(data["periods"]),
            columns=list(data["columns"]),
            rows=[list(row) for row in data["rows"]],
            meta=dict(data["meta"]),
        )

        # 4) 下载并解析资产负债表
        debt_path = await ths_client.download_debt_xls(code)
        try:
            bs_resp = build_bs_chart_response(debt_path, fallback_name=name)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"资产负债表解析失败：{e}")
        finally:
            debt_path.unlink(missing_ok=True)

    except ths_client.ThsThrottleError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except ths_client.ThsFetchError as e:
        raise HTTPException(status_code=502, detail=f"同花顺接口请求失败：{e}")

    # 5) 完整成功才写缓存
    resp = FetchAllResponse(
        code=code,
        company_name=name,
        stock=stock_resp,
        bs=bs_resp,
        cached=False,
    )
    ths_client.put_cached_result(code, resp)
    return resp
