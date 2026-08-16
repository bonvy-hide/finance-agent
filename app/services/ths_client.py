"""同花顺（10jqka）接口客户端

通过爬虫方式调用同花顺固定 GET 接口，自动下载个股财报 / 资产负债表 xls，
并根据股票代码反查股票名称。反爬策略：

- 浏览器伪装：Chrome User-Agent + Referer + Accept 系列头（可选 Cookie）
- 全局节流：对同花顺域任意两次请求间隔 >= THS_MIN_INTERVAL 秒，
  并发请求在服务端排队等待；等待超过 MAX_WAIT_SECONDS 返回 429
- 双层缓存：股票名称（TTL 24h）与解析结果（TTL THS_RESULT_TTL），
  命中缓存时不发起任何外部请求
"""

import asyncio
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import httpx

from app.core.config import (
    THS_COOKIE,
    THS_DEBT_URL,
    THS_DIY_URL,
    THS_MIN_INTERVAL,
    THS_NAME_TTL,
    THS_RESULT_TTL,
    THS_SEARCH_URL,
    THS_USERID,
)

__all__ = [
    "ThsFetchError",
    "ThsThrottleError",
    "fetch_stock_name",
    "download_diy_xls",
    "download_debt_xls",
    "get_cached_result",
    "put_cached_result",
]


class ThsFetchError(Exception):
    """同花顺请求失败（网络异常 / 非 200 / 内容异常）"""


class ThsThrottleError(Exception):
    """请求排队等待超时（过于频繁）"""


# 浏览器伪装请求头
BROWSER_HEADERS: Dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Referer": "https://basic.10jqka.com.cn/",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
}
if THS_COOKIE:
    BROWSER_HEADERS["Cookie"] = THS_COOKIE

REQUEST_TIMEOUT = 15.0        # 单次请求超时（秒）
MAX_WAIT_SECONDS = 15.0       # 节流排队等待上限（秒），超过抛 ThsThrottleError
MIN_CONTENT_BYTES = 512       # 下载内容最小字节数（过小视为无效响应）
MAX_CONTENT_BYTES = 10 * 1024 * 1024  # 下载内容上限（10MB）


# ── 全局节流：串行化 + 最小间隔 ─────────────────
_throttle_lock = asyncio.Lock()
_last_request_ts = 0.0  # monotonic 时间戳


async def _throttled() -> None:
    """获取"请求许可"：保证任意两次外部请求间隔 >= THS_MIN_INTERVAL。

    并发调用在锁上排队；队尾等待超过 MAX_WAIT_SECONDS 时抛 ThsThrottleError，
    由端点转成 429 提示用户稍后再试。
    """
    global _last_request_ts
    async with _throttle_lock:
        now = time.monotonic()
        wait = _last_request_ts + THS_MIN_INTERVAL - now
        if wait > MAX_WAIT_SECONDS:
            raise ThsThrottleError("请求过于频繁，请稍后再试")
        if wait > 0:
            await asyncio.sleep(wait)
        _last_request_ts = time.monotonic()


# ── 股票名称查询（带缓存）──────────────────────
_name_cache: Dict[str, Tuple[float, str]] = {}  # code -> (过期时间戳, 名称)


async def fetch_stock_name(code: str) -> str:
    """根据股票代码查询名称，TTL 内走缓存；查询失败时回退返回 code 本身。

    响应格式：{"data": {"body": [["300520", "科大国创", ...]]}}，取 body[0][1]。
    """
    hit = _name_cache.get(code)
    if hit and hit[0] > time.monotonic():
        return hit[1]

    name = ""
    try:
        url = THS_SEARCH_URL.format(code=code)
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, follow_redirects=True) as client:
            await _throttled()
            resp = await client.get(url, headers=BROWSER_HEADERS)
            resp.raise_for_status()
            payload = resp.json()
        body = ((payload.get("data") or {}).get("body")) or []
        if body and len(body[0]) > 1:
            name = str(body[0][1]).strip()
    except ThsThrottleError:
        raise  # 节流超时要向上传递，不能吞掉
    except Exception:
        # 名称查询失败不应中断整个流程，回退用 code 作为名称
        name = ""

    if not name:
        name = code
    _name_cache[code] = (time.monotonic() + THS_NAME_TTL, name)
    return name


# ── xls 下载 ────────────────────────────────────
async def _download_xls(url: str) -> Path:
    """下载 xls 到临时文件（保留 .xls 后缀供 xlrd 识别），返回临时路径。

    调用方负责在使用后删除临时文件。内容校验失败抛 ThsFetchError。
    """
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT, follow_redirects=True) as client:
            await _throttled()
            resp = await client.get(url, headers=BROWSER_HEADERS)
            resp.raise_for_status()
            content = resp.content
            content_type = resp.headers.get("content-type", "").lower()
    except ThsThrottleError:
        raise
    except Exception as e:
        raise ThsFetchError(f"下载失败：{e}") from e

    # 正常应为 xls 二进制流；返回 json/html 说明被反爬拦截或参数错误
    if "json" in content_type or "html" in content_type:
        raise ThsFetchError(
            "接口返回了非 Excel 内容（可能被反爬拦截），"
            "请稍后重试或在 .env 中配置 THS_COOKIE"
        )
    if len(content) < MIN_CONTENT_BYTES:
        raise ThsFetchError("下载内容过小，疑似无效响应")
    if len(content) > MAX_CONTENT_BYTES:
        raise ThsFetchError("下载内容异常过大，已拒绝")

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".xls")
    try:
        tmp.write(content)
        tmp.flush()
    finally:
        tmp.close()
    return Path(tmp.name)


async def download_diy_xls(code: str) -> Path:
    """下载个股财报（diy_report 模板）xls，返回临时文件路径"""
    url = THS_DIY_URL.format(code=code, userid=THS_USERID)
    return await _download_xls(url)


async def download_debt_xls(code: str) -> Path:
    """下载资产负债表 xls，返回临时文件路径"""
    url = THS_DEBT_URL.format(code=code)
    return await _download_xls(url)


# ── 解析结果缓存（code -> FetchAllResponse）─────
_result_cache: Dict[str, Tuple[float, Any]] = {}


def get_cached_result(code: str) -> Optional[Any]:
    """读取解析结果缓存；过期条目顺手清除"""
    hit = _result_cache.get(code)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    if hit:
        _result_cache.pop(code, None)
    return None


def put_cached_result(code: str, result: Any) -> None:
    """写入解析结果缓存（TTL = THS_RESULT_TTL 秒）"""
    _result_cache[code] = (time.monotonic() + THS_RESULT_TTL, result)
