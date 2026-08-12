# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

## 常用命令

### 安装依赖
```bash
uv sync
```
使用 uv 管理依赖（Python >= 3.12）。依赖定义在 `pyproject.toml`，锁定在 `uv.lock`。新增依赖用 `uv add <package>`。

### 启动 Web 应用
```bash
uv run uvicorn main:app --reload
# 或
uv run python main.py
```
默认监听 http://127.0.0.1:8000 。`--reload` 用于开发热重载。

### 运行 CLI 工具（资产负债表）
```bash
uv run python finance/bs_chart.py "path/to/file.xlsx" -o ./outputs
```
`finance/bs_chart.py` 既是核心算法模块也是独立 CLI，可直接执行输出 HTML/PNG/JSON。

### 没有测试框架
本项目目前没有配置测试框架（无 pytest / unittest 配置）。临时验证可用 `uv run python -c "..."` 或编写临时脚本后删除。PowerShell 终端输出中文需在脚本中加 `sys.stdout.reconfigure(encoding="utf-8")`。

## 架构

### 分层总览

项目采用 **四层分离架构**，核心原则是「算法层无 Web 依赖」：

```
main.py              ─ 入口层：创建 FastAPI app、挂载静态文件、注册路由、页面路由
app/                 ─ 应用层：Web 相关的 HTTP 处理
  ├── api/           ─ 路由层（APIRouter）：每个图表一个路由模块
  ├── schemas/       ─ 响应模型（Pydantic）：统一返回结构
  ├── services/      ─ 服务层：公共逻辑（如 Excel 上传处理）
  └── core/          ─ 配置：路径常量等
finance/             ─ 算法层：纯业务逻辑，无 FastAPI 依赖，可独立 CLI 调用
static/              ─ 前端：单页应用（HTML + JS + CSS，CDN 引入 Chart.js）
```

### 关键设计约定

**1. 算法层与 Web 层分离（`finance/` vs `app/`）**

`finance/bs_chart.py` 是纯业务算法，不 import 任何 FastAPI/HTTP 模块。它既能被 `app/api/` 的路由调用，也能作为 CLI 独立运行（文件末尾保留 `if __name__ == "__main__"` 入口）。**新增图表算法应放在 `finance/` 下，保持同样的无依赖原则。**

**2. 路由注册链路**

路由通过两级 `APIRouter` 聚合到 `main.py`：
- 每个图表在 `app/api/<chart>.py` 中定义自己的 `router = APIRouter(prefix="/api", tags=[...])`
- `app/api/__init__.py` 汇总所有子路由到一个 `router`
- `main.py` 只需 `app.include_router(api_router)` 一次

**新增图表的步骤**：① 在 `finance/` 写算法 → ② 在 `app/api/` 写路由（复用 `app/services/excel_parser.save_upload`） → ③ 在 `app/api/__init__.py` 注册 → ④ 前端按需调用。算法层和路由层都不需要改 `main.py`。

**3. 统一响应模型（`app/schemas/chart.py`）**

所有图表 API 返回 `ChartResponse`，通过 `chart_type` 字段（`bar`/`line`/`pie`/`doughnut`）区分渲染方式，`extra` 字段携带图表特有信息（如资产负债图的 `asset_count` 分界索引）。前端据此统一处理不同图表类型。

**4. 前端与后端的数据契约**

前端 `static/app.js` 通过 `fetch('/api/bs-chart')` 上传文件，后端返回 `ChartResponse` JSON。图表特有信息从 `data.extra` 读取（如 `asset_count`、`raw_rows_count`），而非顶层字段。新增图表时前端需相应增加渲染逻辑。

### 资产负债图核心算法（`finance/bs_chart.py`）

- `DEFAULT_RULES`：16 项合并规则字典，前 9 项资产（蓝色）、后 7 项负债（红色）
- `read_bs(path, unit_hint)`：读取 Excel 第一个 sheet，自动探测「科目列」和「数值列」（表头含日期的列），字段名经 `norm()` 清洗（去括号、空格），数值统一为「元」
- `apply_rules(bs, rules)`：按规则合并原始科目到 16 项。关键策略是 `find_val()` 优先使用含「及」的合并科目（如「应收票据及应收账款」）独立值，避免与子项重复求和；`prefer_precomputed=True` 时优先匹配预计算总计行
- `LABELS = list(DEFAULT_RULES.keys())`：16 项顺序固定，`ASSET_LABELS = LABELS[:9]`、`LIAB_LABELS = LABELS[9:]`

### Excel 读取的注意点

- `read_bs` 会跳过以「其中」「减:」「加:」开头的附注行，避免与合计行重复计入
- 单位推断：`unit_hint="auto"` 时默认视为「元」；数值除以 `unit_div`（元=1, 万元=1e4, 亿元=1e8）统一
- Web 接口固定传 `unit_hint="元"`

### 前端技术栈

- Chart.js 4.x + chartjs-plugin-datalabels（CDN 引入，非 npm）
- Tailwind CSS（CDN）
- 深色金融仪表盘风格，样式在 `static/style.css`
- 单页应用，无构建步骤，直接由 FastAPI 的 `StaticFiles` 挂载提供

### 运行时环境

- Windows + PowerShell 为主开发环境
- 终端默认 GBK 编码，Python 脚本输出中文/特殊符号（如 ✓）可能报错，建议脚本内 `sys.stdout.reconfigure(encoding="utf-8")`
- 临时文件用完即删（见 `app/services/excel_parser.cleanup`）
