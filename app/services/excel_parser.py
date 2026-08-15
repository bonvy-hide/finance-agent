"""Excel 文件上传与解析的公共逻辑"""

import tempfile
from pathlib import Path
from typing import Tuple

from fastapi import HTTPException, UploadFile

from app.core.config import EXCEL_SUFFIXES, TMP_SUFFIX


async def save_upload(file: UploadFile) -> Tuple[Path, str]:
    """保存上传文件到临时路径，返回 (临时路径, 原始文件名)。

    临时文件保留原始扩展名（.xls/.xlsx），因为 xlrd 读 .xls 需要真正的 .xls 后缀。
    调用方负责在使用后删除临时文件。
    """
    filename = file.filename or ""
    if not filename.lower().endswith(EXCEL_SUFFIXES):
        raise HTTPException(
            status_code=400,
            detail=f"仅支持 {'/'.join(EXCEL_SUFFIXES)} 格式的 Excel 文件",
        )

    # 按原始扩展名生成临时文件后缀，保证 xlrd/openpyxl 能正确识别格式
    suffix = Path(filename).suffix or TMP_SUFFIX
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(await file.read())
        tmp.flush()
    finally:
        tmp.close()

    return Path(tmp.name), filename


def cleanup(path: Path) -> None:
    """安全删除临时文件"""
    path.unlink(missing_ok=True)
