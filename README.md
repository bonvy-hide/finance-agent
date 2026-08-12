# Finance Agent

财务图表分析平台 — 上传 Excel 财务报表，自动生成可视化图表。支持 **Web 页面** 和 **命令行** 两种使用方式。

## 功能

- 上传 Excel 资产负债表（.xlsx），自动读取第一个 sheet
- 应用 16 项预设合并规则（9 项资产 + 7 项负债）
- 生成深色主题交互式柱状图（Chart.js）
- 展示数据表格（含金额、占比）和原始 JSON 数据
- 分层架构，便于扩展其他维度图表（利润分析、趋势折线图等）

## 快速开始

### Web 应用（推荐）

```bash
# 安装依赖
uv sync

# 启动服务
uv run uvicorn main:app --reload
```

浏览器访问 http://127.0.0.1:8000 ，拖拽或点击上传 `.xlsx` 文件即可。

### 命令行

```bash
uv run python finance/bs_chart.py "path/to/file.xlsx" -o ./outputs
```

输出 HTML（交互图表）、PNG（静态图）、JSON（分组数据）到指定目录。

## 项目结构

```
finance-agent/
├── main.py                     # 应用入口：创建 FastAPI app、挂载静态文件、注册路由
├── app/                        # 应用层（Web 相关）
│   ├── api/                    # 路由层：每个图表一个 APIRouter 模块
│   │   ├── __init__.py         # 汇总所有子路由
│   │   └── bs_chart.py         # 资产负债图路由 POST /api/bs-chart
│   ├── schemas/
│   │   └── chart.py            # 统一响应模型 ChartResponse（Pydantic）
│   ├── services/
│   │   └── excel_parser.py     # 公共逻辑：上传文件保存/清理
│   └── core/
│       └── config.py           # 配置：路径常量
├── finance/                    # 算法层（无 Web 依赖，可独立 CLI 调用）
│   └── bs_chart.py             # 资产负债表：读取 + 16 项合并规则 + 渲染
├── static/                     # 前端单页应用
│   ├── index.html              # 页面（上传区 + 图表 + 表格 + JSON 折叠）
│   ├── app.js                  # 逻辑（拖拽上传、Chart.js 渲染、表格生成）
│   └── style.css               # 深色金融仪表盘风格样式
└── pyproject.toml              # 依赖配置
```

### 分层职责

| 层 | 职责 |
|---|---|
| `main.py` | 创建 app、挂载静态文件、注册路由、页面路由 |
| `app/api/` | HTTP 路由、请求响应处理（每个图表一个 APIRouter） |
| `app/schemas/` | Pydantic 响应模型，统一返回结构 |
| `app/services/` | 公共服务逻辑（Excel 上传处理等） |
| `finance/` | 纯业务算法，无 FastAPI 依赖，可独立测试或 CLI 调用 |

### 新增图表

1. 在 `finance/` 下编写算法模块（保持无 Web 依赖）
2. 在 `app/api/` 下新建路由模块，复用 `app/services/excel_parser.save_upload`
3. 在 `app/api/__init__.py` 中注册路由
4. 前端按需调用新 API

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/` | 返回前端页面 |
| `POST` | `/api/bs-chart` | 上传资产负债表 Excel，返回 16 项分组数据 JSON |

`POST /api/bs-chart` 返回结构（`ChartResponse`）：

```json
{
  "period": "2024-12-31",
  "title": "资产负债结构",
  "chart_type": "bar",
  "labels": ["总现金", "应收款", "..."],
  "values": [100.0, 50.0, "..."],
  "total": 240.0,
  "groups": {"总现金": 100.0, "...": "..."},
  "extra": {"asset_count": 9, "raw_rows_count": 5}
}
```

## 技术栈

- **后端**：FastAPI + Uvicorn + openpyxl + Python >= 3.12
- **前端**：Chart.js 4.x + chartjs-plugin-datalabels + Tailwind CSS（均 CDN 引入）
- **包管理**：uv
