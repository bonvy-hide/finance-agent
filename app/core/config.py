"""应用配置：路径常量等"""

from pathlib import Path

# 项目根目录（main.py 所在层）
BASE_DIR = Path(__file__).resolve().parents[2]

# 静态文件目录
STATIC_DIR = BASE_DIR / "static"

# 支持的 Excel 扩展名
EXCEL_SUFFIXES = (".xlsx",)

# 临时文件后缀
TMP_SUFFIX = ".xlsx"
