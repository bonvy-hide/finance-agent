"""Excel 文件上传与解析的公共逻辑"""

import tempfile
from pathlib import Path
from typing import Tuple

from fastapi import HTTPException, UploadFile

from app.core.config import EXCEL_SUFFIXES, TMP_SUFFIX


async def save_upload(file: UploadFile) -> Tuple[Path, str]:
    """保存上传文件到临时路径，返回 (临时路径, 原始文件名)。

    调用方负责在使用后删除临时文件。
    """
    filename = file.filename or ""
    if not filename.lower().endswith(EXCEL_SUFFIXES):
        raise HTTPException(
            status_code=400,
            detail=f"仅支持 {'/'.join(EXCEL_SUFFIXES)} 格式的 Excel 文件",
        )

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=TMP_SUFFIX)
    try:
        tmp.write(await file.read())
        tmp.flush()
    finally:
        tmp.close()

    return Path(tmp.name), filename


def cleanup(path: Path) -> None:
    """安全删除临时文件"""
    path.unlink(missing_ok=True)
