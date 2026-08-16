"""应用配置：路径常量、.env 加载、同花顺接口配置

不依赖 python-dotenv：手写 _load_env() 解析项目根目录 .env，
以 KEY=VALUE 形式注入 os.environ（真实环境变量优先，.env 兜底）。
"""

import os
from pathlib import Path

# 项目根目录（main.py 所在层）
BASE_DIR = Path(__file__).resolve().parents[2]

# 静态文件目录
STATIC_DIR = BASE_DIR / "static"

# 支持的 Excel 扩展名（.xls 为 diy_report 原始模板，.xlsx 为资产负债表等）
EXCEL_SUFFIXES = (".xlsx", ".xls")

# 临时文件默认后缀（save_upload 会按原始扩展名覆盖此值）
TMP_SUFFIX = ".xlsx"


def _load_env(path: Path = BASE_DIR / ".env") -> None:
    """解析 .env 文件并注入环境变量（已存在的环境变量不覆盖）。

    支持：KEY=VALUE、# 注释行、空行、值两侧的引号。
    文件不存在时静默跳过（全部配置均有默认值）。
    """
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key:
            continue
        value = value.strip().strip("'\"")
        os.environ.setdefault(key, value)


_load_env()


def _env_float(key: str, default: float) -> float:
    """读取浮点型环境变量，解析失败回退默认值"""
    try:
        return float(os.environ.get(key, "").strip() or default)
    except ValueError:
        return default


# ── 同花顺（10jqka）接口配置 ──────────────────
# URL 模板：{code} 占位符必填，{userid} 仅 diy 接口使用
THS_DIY_URL = os.environ.get(
    "THS_DIY_URL",
    "https://basic.10jqka.com.cn/api/stock/export.php"
    "?export=diy&type=simple&code={code}&userid={userid}",
).rstrip("/")
THS_DEBT_URL = os.environ.get(
    "THS_DEBT_URL",
    "https://basic.10jqka.com.cn/api/stock/export.php"
    "?export=debt&type=report&code={code}",
).rstrip("/")
THS_SEARCH_URL = os.environ.get(
    "THS_SEARCH_URL",
    "https://news.10jqka.com.cn/app/headline/mobi-stockdict/v1/search/"
    "?isrealcode=1&associate=1&json=1&markettype=2&query={code}",
).rstrip("/")

# diy 接口的 userid 参数（个人标识，可配置为自己的）
THS_USERID = os.environ.get("THS_USERID", "723895634")

# 对同花顺域任意两次请求的最小间隔（秒），防止请求过频被拉黑
THS_MIN_INTERVAL = _env_float("THS_MIN_INTERVAL", 2.0)

# 单只股票解析结果的缓存时长（秒），期间重复请求不再访问外部接口
THS_RESULT_TTL = _env_float("THS_RESULT_TTL", 600.0)

# 股票名称缓存的时长（秒）
THS_NAME_TTL = _env_float("THS_NAME_TTL", 86400.0)

# 可选：手动配置同花顺 Cookie（如遇反爬拦截时填写，格式 k1=v1; k2=v2）
THS_COOKIE = os.environ.get("THS_COOKIE", "")

__all__ = [
    "BASE_DIR",
    "STATIC_DIR",
    "EXCEL_SUFFIXES",
    "TMP_SUFFIX",
    "THS_DIY_URL",
    "THS_DEBT_URL",
    "THS_SEARCH_URL",
    "THS_USERID",
    "THS_MIN_INTERVAL",
    "THS_RESULT_TTL",
    "THS_NAME_TTL",
    "THS_COOKIE",
]
