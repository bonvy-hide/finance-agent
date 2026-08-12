---
name: fastapi-bs-chart-web
overview: 将 bs_chart.py 改造为 FastAPI Web 应用：前端页面支持上传 Excel 文件，后端调用现有核心逻辑处理数据并返回 JSON，前端使用 Chart.js 渲染美观的深色主题柱状图，并附带数据表格和原始 JSON 展示。
design:
  architecture:
    framework: html
  styleKeywords:
    - Dark Theme
    - Glassmorphism
    - Financial Dashboard
    - Gradient Background
    - Micro-interactions
  fontSystem:
    fontFamily: Noto Sans
    heading:
      size: 24px
      weight: 600
    subheading:
      size: 16px
      weight: 500
    body:
      size: 14px
      weight: 400
  colorSystem:
    primary:
      - "#3a7ecf"
      - "#d63031"
    background:
      - "#1a1a2e"
      - "#16213e"
      - "#0f3460"
    text:
      - "#e0e0e0"
      - "#a0a0a0"
      - "#ffffff"
    functional:
      - "#00b894"
      - "#e74c3c"
      - "#f39c12"
todos:
  - id: add-deps
    content: 更新 pyproject.toml 添加 fastapi、uvicorn、python-multipart 依赖
    status: completed
  - id: create-backend
    content: 改造 main.py 为 FastAPI 应用，实现文件上传 API 和页面路由
    status: completed
    dependencies:
      - add-deps
  - id: create-frontend
    content: 创建 static 目录下 index.html、app.js、style.css 前端页面
    status: completed
    dependencies:
      - create-backend
  - id: integrate-chart
    content: 实现 Chart.js 柱状图渲染、数据表格和 JSON 折叠展示
    status: completed
    dependencies:
      - create-frontend
  - id: test-verify
    content: 验证完整流程：启动服务、上传文件、确认图表展示正常
    status: completed
    dependencies:
      - integrate-chart
---

## 产品概述

将现有的命令行资产负债表柱状图工具改造为 Web 应用。用户通过浏览器页面上传 Excel 文件（.xlsx），系统自动读取第一个 sheet 数据，应用 16 项合并规则，在页面中展示美观的交互式柱状图、数据表格及原始 JSON 数据。

## 核心功能

- 文件上传：支持拖拽或点击上传 .xlsx 文件，实时反馈上传状态
- 数据处理：复用现有 `read_bs` + `apply_rules` 逻辑，将 Excel 转换为 16 项分组数据
- 图表展示：Chart.js 深色主题柱状图，蓝色资产侧 9 项 + 红色负债侧 7 项，带数值标签
- 数据表格：16 项分组明细，含分组名、金额（亿元）、占比百分比
- JSON 数据：可折叠区域展示原始处理后的 JSON 数据
- 错误处理：文件格式错误、解析异常时给出友好提示

## 技术栈

- **后端框架**：FastAPI + Uvicorn（Python 3.12）
- **文件上传**：python-multipart（FastAPI 文件上传依赖）
- **Excel 解析**：openpyxl（现有依赖，复用 `bs_chart.py` 核心函数）
- **前端**：原生 HTML + CSS + JavaScript，无需构建工具
- **图表库**：Chart.js 4.x + chartjs-plugin-datalabels（CDN 引入）
- **样式**：Tailwind CSS（CDN 引入）+ 自定义深色主题样式

## 实现方案

### 后端架构

FastAPI 应用提供三个核心端点：

- `GET /` — 返回前端页面 HTML（`HTMLResponse`）
- `POST /api/chart` — 接收 UploadFile，保存临时文件，调用 `read_bs` + `apply_rules`，返回 JSON 结构化数据
- `GET /static/{path}` — 静态文件托管（CSS/JS）

数据处理流程：上传文件 → 保存临时文件 → `read_bs(path)` → `apply_rules(bs, DEFAULT_RULES)` → 构造 JSON 响应 → 删除临时文件。

API 返回结构：

```
{
  "period": "2024-12-31",
  "labels": ["总现金", "应收款", ...],
  "values": [12.34, 5.67, ...],
  "asset_count": 9,
  "raw_rows_count": 45,
  "groups": {"总现金": 12.34, ...},
  "total": 100.0
}
```

### 关键技术决策

1. **复用核心逻辑**：`bs_chart.py` 中的 `read_bs`、`apply_rules`、`DEFAULT_RULES`、`LABELS` 保持不变，仅作为模块导入。CLI `main()` 保留以兼容原有命令行用法。
2. **JSON + 前端渲染**（非 iframe 内嵌 HTML）：后端只返回数据，前端用 Chart.js 自行渲染，样式完全可控，比复用 `render_html` 更灵活美观。
3. **临时文件处理**：上传文件保存到系统临时目录，处理完成后立即删除，避免磁盘堆积。使用 `tempfile.NamedTemporaryFile` + `try/finally` 确保清理。
4. **前端 CDN 引入**：Tailwind CSS + Chart.js 均通过 CDN 引入，无需 npm 构建，保持项目简洁。

### 性能考虑

- Excel 解析为单次操作，数据量有限（资产负债表通常百行级），无性能瓶颈
- 临时文件即用即删，无 I/O 累积
- Chart.js 客户端渲染，服务端零渲染开销

### 实现备注

- `bs_chart.py` 的 `read_bs` 接收 `Path` 对象，需将 `UploadFile` 保存为临时文件后传入
- `apply_rules` 返回值的单位是「元」，前端展示时需转换为「亿元」（除以 1e8），与现有 `render_html` 逻辑一致
- `LABELS` 列表前 9 项为资产侧（蓝色），后 7 项为负债侧（红色），前端据此着色
- 文件上传需校验扩展名 `.xlsx`，拒绝其他格式
- 保留 `bs_chart.py` 的 CLI 入口 `main()` 不变，确保向后兼容

## 目录结构

```
finance-agent/
├── finance/
│   └── bs_chart.py              # [不改] 核心逻辑保持不变，作为模块被导入
├── main.py                      # [修改] 改为 FastAPI 应用入口
├── static/
│   ├── index.html               # [新建] 前端页面（上传 + 图表 + 表格 + JSON）
│   ├── app.js                   # [新建] 前端逻辑（文件上传、Chart.js 渲染、表格生成）
│   └── style.css                # [新建] 自定义样式（深色主题、动画、布局微调）
├── pyproject.toml               # [修改] 新增 fastapi、uvicorn、python-multipart 依赖
└── README.md                    # [修改] 更新运行说明
```

### 文件详情

**main.py** [修改] — FastAPI 应用入口

- 创建 `FastAPI()` 实例，挂载 `/static` 静态文件目录
- `GET /`：读取 `static/index.html` 返回 `HTMLResponse`
- `POST /api/chart`：接收 `UploadFile`，校验 `.xlsx` 扩展名，保存临时文件，调用 `finance.bs_chart.read_bs` + `apply_rules`，构造 JSON 响应（值转为亿元），`finally` 中删除临时文件
- 异常处理：返回 `{"error": "..."}` + HTTP 400/500

**static/index.html** [新建] — 前端页面

- 深色主题，Tailwind CSS CDN
- 上传区：拖拽 + 点击，文件名展示，上传按钮
- 结果区：标题（报告期）、图例、Chart.js canvas、数据表格、JSON 折叠区
- 引入 `app.js` 和 `style.css`

**static/app.js** [新建] — 前端逻辑

- 拖拽上传事件处理
- `fetch('/api/chart', {method:'POST', body:FormData})` 调用后端
- Chart.js 柱状图配置：深色主题、蓝/红双色、datalabels 数值标签、45 度 x 轴标签
- 表格生成：16 项分组名、金额（亿元）、占比（%）
- JSON 折叠展示
- 错误提示处理

**static/style.css** [新建] — 自定义样式

- 深色背景渐变、卡片毛玻璃效果、上传区悬停高亮、表格条纹、微动画

**pyproject.toml** [修改] — 新增依赖

- `fastapi`、`uvicorn[standard]`、`python-multipart`

## 设计风格

采用深色科技感金融仪表盘风格，整体氛围沉稳专业。深色渐变背景配合毛玻璃卡片效果，蓝色（资产）与红色（负债）的强对比色系，营造金融数据可视化的高端感。微动画增强交互反馈，拖拽上传区域有呼吸光效。

## 页面布局（单页面）

- **顶部导航栏**：应用标题"资产负债结构分析" + 简短描述，毛玻璃半透明背景
- **上传区块**：居中大尺寸拖拽区域，虚线边框，悬停时蓝色光晕呼吸效果，支持点击选择文件，上传后显示文件名和解析状态
- **图表区块**：全宽 Chart.js 柱状图卡片，顶部显示报告期标题 + 资产/负债图例标签，深色画布背景，柱状图带数值标签
- **数据表格区块**：图表下方双列布局，左列为 9 项资产表格（蓝色表头），右列为 7 项负债表格（红色表头），每行显示分组名、金额（亿元）、占比百分比，条纹斑马纹
- **JSON 数据折叠区**：底部可折叠区域，点击展开显示原始 JSON，等宽字体，语法高亮风格

## 响应式设计

- 桌面端：表格双列并排，图表全宽
- 移动端：表格单列堆叠，图表自适应宽度

## Agent Extensions

### Skill

- **lsp-code-analysis**
- Purpose: 在实现过程中使用 LSP 语义分析验证 `bs_chart.py` 模块的函数签名和导入关系，确保 `read_bs`、`apply_rules`、`DEFAULT_RULES`、`LABELS` 等符号被正确引用
- Expected outcome: 确认模块导入路径和函数签名无误，避免运行时 ImportError 或参数不匹配