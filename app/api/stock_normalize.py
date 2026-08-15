"""标准化数据上传路由

POST /api/normalize
    接收 multipart/form-data（file + company_name），
    调用 finance.stock_normalize.normalize() 实时转换为标准化数据，
    存入 app.services.data_store 缓存并返回 data_id。
    前端持有 data_id 后并发请求 6 个图表端点。
"""

from fastapi import APIRouter, File, Form, UploadFile, HTTPException

from app.schemas.chart import NormalizeResponse
from app.services.data_store import put as store_put
from app.services.excel_parser import save_upload, cleanup
from finance.stock_normalize import normalize, NormalizedData


router = APIRouter(prefix="/api", tags=["标准化数据"])


@router.post("/normalize", response_model=NormalizeResponse)
async def normalize_file(
    file: UploadFile = File(..., description="原始个股财报 .xls 文件（diy_report 模板）"),
    company_name: str = Form("", description="公司名称（用于图表标题）"),
) -> NormalizeResponse:
    """上传 .xls 财报文件，实时转换为标准化数据并缓存。

    流程：
        1. save_upload 保存临时 .xls
        2. finance.stock_normalize.normalize() 转换为 NormalizedData
        3. data_store.put() 存入进程内 LRU 缓存，返回 data_id
        4. cleanup 临时文件
        5. 返回 NormalizeResponse（含 data_id / periods / columns / rows / company_name）

    前端拿到 data_id 后，可并发请求 /api/charts/{name}?data_id=xxx 获取 6 个图表。
    """
    tmp_path, filename = await save_upload(file)
    try:
        # 实时转换（不落地中间文件）
        try:
            data: NormalizedData = normalize(tmp_path)
        except ValueError as e:
            # 文件结构异常（如无报告期表头、行列数不足）
            raise HTTPException(status_code=400, detail=f"Excel 解析失败：{e}")
        except Exception as e:
            # 其他解析错误（如 xlrd 无法打开、格式不符）
            raise HTTPException(status_code=400, detail=f"文件读取失败：{e}")

        # 存入缓存，返回 data_id
        data_id = store_put(
            data=data,
            company_name=company_name.strip(),
            source_file=filename,
        )

        # 组装响应（data_id 来自缓存层，其余字段来自 NormalizedData + 来源信息）
        return NormalizeResponse(
            data_id=data_id,
            company_name=company_name.strip(),
            source_file=filename,
            periods=list(data["periods"]),
            columns=list(data["columns"]),
            rows=[list(row) for row in data["rows"]],
            meta=dict(data["meta"]),
        )
    finally:
        cleanup(tmp_path)
