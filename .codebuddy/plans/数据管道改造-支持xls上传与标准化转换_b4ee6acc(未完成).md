---
name: 数据管道改造-支持xls上传与标准化转换
overview: 将 scripts/convert_stock_data.py 的转换逻辑抽取为 finance/stock_normalize.py 算法模块（符合四层架构），扩充新增 6 个科目（营业成本/销售毛利率转小数/销售费用/管理费用/研发费用/应付票据及应付账款，只输出单期值不算 TTM），基于科目名匹配而非行号；改造上传链路支持 .xls 实时转换不落地；保留 bs_chart 不动；scripts/convert_stock_data.py 改为薄 CLI 包装调用新模块。
todos:
  - id: extract-finance-module
    content: 抽取 finance/stock_normalize.py 算法模块，扩充 6 个新增科目映射与输出列，新增 _parse_percent 毛利率转小数逻辑，提供 normalize() 高层接口
    status: pending
  - id: refactor-cli-script
    content: 改造 scripts/convert_stock_data.py 为薄 CLI 包装，调用 finance.stock_normalize 模块
    status: pending
    dependencies:
      - extract-finance-module
  - id: add-normalize-api
    content: 新增 app/schemas/chart.py 中 NormalizeResponse 模型，新增 app/api/stock_normalize.py 路由，在 app/api/__init__.py 注册
    status: pending
    dependencies:
      - extract-finance-module
  - id: update-upload-chain
    content: 改造 app/core/config.py 扩展 EXCEL_SUFFIXES 支持 .xls，改造 app/services/excel_parser.py 保留原始扩展名
    status: pending
  - id: update-frontend
    content: 更新 static/index.html 和 static/app.js 支持 .xls 文件上传
    status: pending
    dependencies:
      - update-upload-chain
  - id: verify-pipeline
    content: 用 [subagent:code-explorer] 验证全链路 import 和调用关系，用新模板 .xls 文件通过 CLI 和 Web 端点分别验证输出正确性
    status: pending
    dependencies:
      - refactor-cli-script
      - add-normalize-api
      - update-upload-chain
      - update-frontend
---

## 产品概述

将原始个股财报 .xls（diy_report 格式）的上传与格式转换链路打通，使后端能实时接收 .xls 文件、自动转换为标准化数据（含新增科目），为后续基于标准化数据的业务图表提供统一数据管道。

## 核心功能

- 上传按钮支持 .xls 格式（diy_report 模板），后端实时转换为标准化数据结构，不落地中间文件
- 转换逻辑从 scripts/ 抽取到 finance/stock_normalize.py 作为纯算法模块，CLI 和 Web 共用
- 标准化输出扩充 6 个新增科目：营业成本、销售毛利率（转小数）、销售费用、管理费用、研发费用、应付票据及应付账款（均只输出单期值，不算 TTM）
- 科目匹配基于科目名（顺序可变），不依赖行号
- 保留现有 bs_chart（资产负债图）路由不动，新增标准化数据转换 API 端点
- 保留 scripts/convert_stock_data.py 作为薄 CLI 包装，调用 finance/stock_normalize.py

## 技术栈

- 后端：FastAPI + Python 3.12（已有）
- Excel 读取：xlrd 2.0.2（读 .xls）、openpyxl 3.1.5（写 .xlsx，CLI 模式用）
- 依赖管理：uv（pyproject.toml，xlrd 已在依赖中）
- 前端：原生 HTML + JS + Chart.js（已有，本次仅改上传接受格式）

## 实现方案

### 核心策略

1. **抽取算法模块** `finance/stock_normalize.py`：将 `scripts/convert_stock_data.py` 的核心逻辑（read_stock_xls / compute_derived / compute_ttm / build_output_rows / write_xlsx）迁移为独立模块，不 import 任何 FastAPI/HTTP 模块，符合四层架构约定
2. **新增 Web 端点** `app/api/stock_normalize.py`：接收 .xls 上传，调用 finance 模块实时转换，返回标准化数据 JSON（非 ChartResponse，因为这是数据管道而非图表端点）
3. **改造上传链路**：config.py 扩展 EXCEL_SUFFIXES 支持 .xls，excel_parser.py 临时文件后缀保留原始扩展名
4. **薄 CLI 包装**：scripts/convert_stock_data.py 改为 import finance.stock_normalize 并调用

### 关键技术决策

**科目匹配改为名称查找而非行号**：

- 新模板科目顺序可能变化，`read_stock_xls` 已基于科目名读取（遍历所有行，按 label 存入 dict），天然支持顺序可变
- `LABEL_MAP` 扩充 6 个新科目映射，`OUTPUT_COLUMNS` 扩充对应输出列
- `build_output_rows` 中新增科目只走单期值路径，不进 TTM 计算

**销售毛利率百分比转小数**：

- xlrd 读取百分比单元格时返回字符串如 `"19.82%"`
- 在 `_to_float` 之后增加 `_parse_percent` 逻辑：若值以 `%` 结尾，strip 后除以 100 转小数（如 `0.1982`）
- 输出时用数字格式 `0.0000` 显示（4 位小数）

**`'--'` 缺失值处理**：

- 新模板部分单元格为字符串 `'--'`（如 2016-09-30 销售商品收到的现金）
- `_to_float` 已处理：`float('--')` 会抛 ValueError，返回 None，该期该科目不写入 dict

**新增科目输出列布局**（在原有 11 列基础上追加）：

```
原 11 列: 科目\时间 | 滚动总营收 | 滚动现金流 | 滚动净利润 | 滚动现金流净额 | 归母净资产 | 总营收 | 主业现金流 | 净利润 | 现金流净额 | 自由现金流FCF
新增 6 列: 营业成本 | 销售毛利率 | 销售费用 | 管理费用 | 研发费用 | 应付票据及应付账款
```

**Web 端返回结构**：

- 不复用 `ChartResponse`（那是图表响应模型），新增 `NormalizeResponse` schema
- 返回 `{ periods: [...], columns: [...], rows: [[...]], meta: {source_file, period_count, column_count} }`
- 前端后续图表路由可调用此端点获取标准化数据

### 性能与可靠性

- xlrd 读取 .xls 文件通常 < 50KB，解析耗时 < 100ms，无性能瓶颈
- TTM 计算为 O(n) 遍历，43 个报告期无压力
- 临时文件用完即删（复用 excel_parser.cleanup）
- 科目缺失时返回 None 而非报错，保证部分数据缺失仍可输出

## 架构设计

### 数据流

```
用户上传 .xls
  → app/services/excel_parser.save_upload (保存临时 .xls)
  → app/api/stock_normalize.py 路由
  → finance/stock_normalize.py (read_stock_xls → compute_derived → compute_ttm → build_output_rows)
  → NormalizeResponse JSON 返回前端
  → cleanup 临时文件
```

### CLI 数据流（保持不变）

```
scripts/convert_stock_data.py --input xxx.xls --output xxx.xlsx
  → finance/stock_normalize.py (同上算法)
  → write_xlsx 落地 xlsx 文件
```

## 目录结构

```
finance-agent/
├── finance/
│   ├── bs_chart.py               # [不动] 资产负债图算法
│   └── stock_normalize.py        # [NEW] 个股财报标准化算法模块。从 scripts/convert_stock_data.py 抽取核心逻辑，
│                                  #   包含 read_stock_xls / compute_derived / compute_ttm / build_output_rows / write_xlsx。
│                                  #   扩充 LABEL_MAP 新增 6 个科目映射，OUTPUT_COLUMNS 追加 6 列。
│                                  #   新增 _parse_percent 处理毛利率百分比转小数。
│                                  #   新增 normalize(path) -> NormalizeData 高层接口供 Web 调用。
│                                  #   不 import FastAPI/HTTP，可独立 CLI 调用。
├── app/
│   ├── core/
│   │   └── config.py             # [MODIFY] EXCEL_SUFFIXES 扩展为 (".xlsx", ".xls")，TMP_SUFFIX 改为按原始扩展名动态保留
│   ├── services/
│   │   └── excel_parser.py       # [MODIFY] save_upload 保存临时文件时保留原始扩展名（.xls 文件用 .xls 后缀，xlrd 需要正确后缀）
│   ├── schemas/
│   │   └── chart.py              # [MODIFY] 新增 NormalizeResponse 模型（periods/columns/rows/meta）
│   ├── api/
│   │   ├── __init__.py           # [MODIFY] 注册 stock_normalize 路由
│   │   ├── bs_chart.py           # [不动]
│   │   └── stock_normalize.py    # [NEW] 标准化数据转换路由。POST /api/normalize 接收 .xls 上传，
│   │                              #   调用 finance.stock_normalize.normalize() 返回 NormalizeResponse。
│   │                              #   复用 excel_parser.save_upload / cleanup。
├── scripts/
│   └── convert_stock_data.py     # [MODIFY] 改为薄 CLI 包装，import finance.stock_normalize 并调用，
│                                  #   保留 --input/--output 参数和 write_xlsx 落地逻辑
├── static/
│   ├── index.html                # [MODIFY] file input accept 改为 ".xlsx,.xls"，提示文案更新
│   └── app.js                    # [MODIFY] handleFile 中扩展名检查支持 .xls
└── pyproject.toml                # [不动] xlrd 已在依赖中
```

## 关键代码结构

### NormalizeResponse 模型（app/schemas/chart.py 新增）

```python
class NormalizeResponse(BaseModel):
    """标准化数据转换响应"""
    source_file: str = Field(..., description="原始文件名")
    periods: List[str] = Field(default_factory=list, description="报告期列表 (YYYY-MM-DD)")
    columns: List[str] = Field(default_factory=list, description="列名列表")
    rows: List[List[Optional[float]]] = Field(default_factory=list, description="数据行，每行对应一个报告期")
    meta: Optional[Dict] = Field(None, description="元信息 (period_count, column_count, ttm_columns 等)")
```

### finance/stock_normalize.py 关键常量扩充

```python
# 新增的 LABEL_MAP 映射
LABEL_MAP_ADDITIONS: Dict[str, str] = {
    "营业成本": "其中：营业成本(元)",
    "销售毛利率": "销售毛利率",
    "销售费用": "销售费用(元)",
    "管理费用": "管理费用(元)",
    "研发费用": "研发费用(元)",
    "应付票据及应付账款": "应付票据及应付账款(元)",
}

# 扩充后的 OUTPUT_COLUMNS 末尾追加
# "营业成本", "销售毛利率", "销售费用", "管理费用", "研发费用", "应付票据及应付账款"
```

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 深度搜索 finance/ 和 app/ 目录下的代码结构、import 关系和调用链路，确保抽取模块时不遗漏依赖
- Expected outcome: 确认 finance/stock_normalize.py 抽取后所有引用方（scripts/convert_stock_data.py、app/api/ 路由）的 import 路径正确