"""标准化数据的进程内 LRU 缓存

上传 .xls → finance.stock_normalize.normalize() 得到 NormalizedData 后，
通过 put() 存入此缓存并返回 data_id；6 个图表端点通过 get(data_id) 复用同一份数据。

设计说明：
    - 进程内 dict + OrderedDict 实现 LRU（不依赖 Redis/Session）
    - 上限 100 条，超出淘汰最旧（按访问顺序）
    - 进程重启即清空（无持久化，符合"实时转换不落地"约定）
    - 线程安全：FastAPI 单进程事件循环下并发读安全；写操作加锁防止竞态
"""

from __future__ import annotations

import threading
import uuid
from collections import OrderedDict
from typing import Any, Dict, List, Optional

from finance.stock_normalize import NormalizedData


# 缓存条目结构：在 NormalizedData 基础上附加来源信息
class CacheEntry:
    """单个标准化数据缓存条目。

    封装 NormalizedData 及其来源信息（公司名、原始文件名），
    供图表算法函数和 NormalizeResponse 共用。
    """

    __slots__ = ("data", "company_name", "source_file")

    def __init__(self, data: NormalizedData, company_name: str, source_file: str) -> None:
        self.data: NormalizedData = data
        self.company_name: str = company_name
        self.source_file: str = source_file


# LRU 上限
_DEFAULT_MAX_SIZE = 100

# 进程内缓存（OrderedDict 保持插入顺序，move_to_end 实现 LRU）
_store: "OrderedDict[str, CacheEntry]" = OrderedDict()
_lock = threading.Lock()
_max_size = _DEFAULT_MAX_SIZE


def put(
    data: NormalizedData,
    company_name: str = "",
    source_file: str = "",
    data_id: Optional[str] = None,
) -> str:
    """存入标准化数据，返回 data_id。

    Args:
        data:           finance.stock_normalize.normalize() 的返回值
        company_name:   用户输入的公司名（用于图表标题）
        source_file:    原始 .xls 文件名
        data_id:        可选，自定义 ID；默认生成 12 位 uuid hex

    Returns:
        data_id 字符串
    """
    if data_id is None:
        data_id = uuid.uuid4().hex[:12]

    entry = CacheEntry(data=data, company_name=company_name, source_file=source_file)

    with _lock:
        # 已存在则更新并移到末尾（最近使用）
        if data_id in _store:
            _store.move_to_end(data_id)
        _store[data_id] = entry

        # LRU 淘汰：超出上限时弹出最旧（OrderedDict 首项）
        while len(_store) > _max_size:
            _store.popitem(last=False)

    return data_id


def get(data_id: str) -> Optional[CacheEntry]:
    """按 data_id 取缓存条目，命中时标记为最近使用。

    Returns:
        CacheEntry 或 None（未命中）
    """
    with _lock:
        entry = _store.get(data_id)
        if entry is None:
            return None
        _store.move_to_end(data_id)  # 标记最近使用
        return entry


def delete(data_id: str) -> bool:
    """删除指定 data_id 的缓存条目。

    Returns:
        True 表示已删除，False 表示不存在
    """
    with _lock:
        if data_id in _store:
            del _store[data_id]
            return True
        return False


def clear() -> None:
    """清空全部缓存"""
    with _lock:
        _store.clear()


def size() -> int:
    """返回当前缓存条目数"""
    with _lock:
        return len(_store)


def set_max_size(new_size: int) -> None:
    """动态调整 LRU 上限，并立即触发淘汰。

    主要用于测试和初始化配置。
    """
    global _max_size
    if new_size < 1:
        raise ValueError("max_size 必须 >= 1")
    with _lock:
        _max_size = new_size
        while len(_store) > _max_size:
            _store.popitem(last=False)


def to_normalize_response_fields(entry: CacheEntry) -> Dict[str, Any]:
    """把 CacheEntry 转换为 NormalizeResponse 所需的字段 dict。

    便于 app/api/stock_normalize.py 路由直接构造响应：
        entry = data_store.get(data_id)
        resp = NormalizeResponse(**data_store.to_normalize_response_fields(entry))
    """
    data = entry.data
    return {
        "company_name": entry.company_name,
        "source_file": entry.source_file,
        "periods": list(data["periods"]),
        "columns": list(data["columns"]),
        "rows": [list(row) for row in data["rows"]],
        "meta": dict(data["meta"]),
    }


__all__ = [
    "CacheEntry",
    "put",
    "get",
    "delete",
    "clear",
    "size",
    "set_max_size",
    "to_normalize_response_fields",
]
