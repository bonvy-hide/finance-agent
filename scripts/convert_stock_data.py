"""个股财报数据标准化转换 CLI（薄包装）。

业务逻辑已抽取到 `finance.stock_normalize` 模块，本脚本仅保留：
    - argparse 命令行参数解析
    - 调用 finance.stock_normalize 完成转换
    - 进度日志输出

Usage:
    uv run python scripts/convert_stock_data.py
    uv run python scripts/convert_stock_data.py --input path/to/input.xls --output path/to/output.xlsx

也可直接运行算法模块：
    uv run python -m finance.stock_normalize --input xxx --output xxx
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Windows 控制台中文/特殊字符兼容
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

# 脚本位于 <root>/scripts/ 下，运行时需把项目根目录加入 sys.path
# 才能正确 import finance 算法层模块
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# 算法层模块（四层架构：CLI 层调用 finance 算法层，不直接处理业务逻辑）
from finance.stock_normalize import (
    DEFAULT_INPUT,
    DEFAULT_OUTPUT,
    OUTPUT_COLUMNS,
    OUTPUT_START_YEAR,
    build_output_rows,
    compute_derived,
    read_stock_xls,
    write_xlsx,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="个股财报数据标准化转换")
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help="输入 .xls 文件路径（diy_report 模板）",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="输出 .xlsx 文件路径",
    )
    args = parser.parse_args()

    input_path: Path = args.input
    output_path: Path = args.output

    if not input_path.exists():
        print(f"[ERROR] 输入文件不存在：{input_path}")
        return 1

    print(f"[1/3] 读取源文件：{input_path}")
    data, periods = read_stock_xls(input_path)
    print(f"      科目数：{len(data)}，报告期数：{len(periods)}")
    print(f"      时间范围：{periods[0]} ~ {periods[-1]}")

    print("[2/3] 计算归母净资产、自由现金流FCF、滚动TTM")
    compute_derived(data)
    out_periods, rows = build_output_rows(data, periods, OUTPUT_START_YEAR)
    print(f"      输出周期：{out_periods[0]} ~ {out_periods[-1]}，共 {len(out_periods)} 期")

    print(f"[3/3] 写入输出文件：{output_path}")
    write_xlsx(rows, output_path)
    print(f"      完成。列：{len(OUTPUT_COLUMNS)}，行：{len(rows) + 1}（含表头）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
