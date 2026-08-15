"""应用配置：路径常量等"""

from pathlib import Path

# 项目根目录（main.py 所在层）
BASE_DIR = Path(__file__).resolve().parents[2]

# 静态文件目录
STATIC_DIR = BASE_DIR / "static"

# 支持的 Excel 扩展名（.xls 为 diy_report 原始模板，.xlsx 为资产负债表等）
EXCEL_SUFFIXES = (".xlsx", ".xls")

# 临时文件默认后缀（save_upload 会按原始扩展名覆盖此值）
TMP_SUFFIX = ".xlsx"
