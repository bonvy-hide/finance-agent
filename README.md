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
| `POST` | `/api/normalize` | 上传个股财报 .xls（diy_report 模板），返回标准化数据 |
| `POST` | `/api/fetch-all?code={code}` | 在线获取：从同花顺下载两份 xls 并解析，一次返回个股财报 + 资产负债表两套结果 |

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

## 在线获取与缓存

`POST /api/fetch-all` 输入 6 位股票代码，后端模拟浏览器从同花顺下载个股财报（diy）与资产负债表（debt）两份 xls，解析后一次返回两套图表数据。为避免请求过于频繁被拉黑，实现了**两层后端内存缓存**（前端不缓存，每次点击都请求后端，由后端统一判断）：

| 缓存层 | 键 → 值 | 默认 TTL | 目的 |
|---|---|---|---|
| 结果缓存 | 股票代码 → 完整解析结果（`FetchAllResponse`，两套图表数据） | 10 分钟（`THS_RESULT_TTL`） | 重复请求同一代码时零外部请求、秒回 |
| 名称缓存 | 股票代码 → 股票名 | 24 小时（`THS_NAME_TTL`） | 结果缓存过期后重新下载时，省掉一次搜索接口查名称的请求 |

实现位于 `app/services/ths_client.py`（模块级字典，每条目存「过期时间戳 + 数据」，读取时比较 `time.monotonic()` 判断过期）。

### 请求流程

1. 校验 6 位数字代码 → 查**结果缓存**，命中直接返回（响应中 `cached: true`，不请求同花顺、不受节流限制）；
2. 未命中 → 查名称缓存拿股票名（过期才调搜索接口）→ 下载 diy.xls → 下载 debt.xls（全局限流，任意两次对同花顺的请求间隔 ≥ `THS_MIN_INTERVAL`，默认 2 秒）→ 解析 → **两套都成功才写入结果缓存** → 返回（`cached: false`）。

### 设计要点

- **纯内存、无数据库**：服务重启后缓存清空，下次请求重新下载；财报为季度级数据，10 分钟 TTL 平衡了新鲜度与防限流
- **只在完全成功时缓存**：任一步失败（下载、解析）都不落缓存，保证缓存内永远是完整可用的结果
- **限流排队**：并发请求按全局队列串行等待，等待超过 15 秒返回 429「请求过于频繁」
- **所有参数均可在 `.env` 配置**（模板见 `.env.example`，无需改代码）：

```ini
THS_RESULT_TTL=600        # 结果缓存有效期（秒）
THS_NAME_TTL=86400        # 股票名缓存有效期（秒）
THS_MIN_INTERVAL=2.0      # 对同花顺请求的最小间隔（秒）
THS_USERID=723895634      # diy 导出接口的 userid
THS_COOKIE=               # 可选：登录 Cookie，提高下载成功率
```

## 技术栈

- **后端**：FastAPI + Uvicorn + openpyxl + Python >= 3.12
- **前端**：Chart.js 4.x + chartjs-plugin-datalabels + Tailwind CSS（均 CDN 引入）
- **包管理**：uv
- **生产部署**：Docker + Gunicorn + Uvicorn workers

## 云服务器部署（Docker）

### 前置条件

- 一台云服务器（阿里云 / 腾讯云等），已安装 **Docker** 和 **Docker Compose**
- 服务器安全组已放行 **8080 端口**（入站 TCP）
- 一个 Git 仓库地址（本项目的远程仓库）

### 安装 Docker（如未安装）

以 Ubuntu / Debian 为例：

```bash
# 一键安装 Docker
curl -fsSL https://get.docker.com | sh

# 将当前用户加入 docker 组（免 sudo）
sudo usermod -aG docker $USER

# 重新登录使权限生效，然后验证
docker --version
docker compose version
```

CentOS / 其他系统参见 [Docker 官方文档](https://docs.docker.com/engine/install/)。

### 部署步骤

```bash
# 1. 克隆代码到服务器
cd ~
git clone https://<你的仓库地址>/finance-agent.git
cd ~/finance-agent

# 2. （可选）创建环境配置文件
#    如需自定义同花顺接口参数，复制模板并编辑
cp .env.example .env
vi .env

# 3. 构建镜像并启动服务（后台运行）
docker compose up -d --build

# 4. 查看启动日志，确认正常运行
docker compose logs -f
```

启动成功后，浏览器访问：

```
http://<服务器公网IP>:8080
```

### 后续更新

当仓库有新代码时，在服务器上执行：

```bash
cd ~/finance-agent
git pull
docker compose up -d --build
```

`docker compose up --build` 会检测 `Dockerfile` 或源码变更并重新构建镜像，然后替换旧容器启动。**无需手动停止服务**，Docker Compose 会自动处理。

### 常用运维命令

在 `~/finance-agent` 目录下执行：

```bash
# 查看运行状态
docker compose ps

# 查看实时日志
docker compose logs -f

# 停止服务（容器保留）
docker compose stop

# 启动已有服务
docker compose start

# 停止并删除容器（镜像保留，下次启动复用）
docker compose down

# 停止并删除容器 + 镜像（下次需重新构建）
docker compose down --rmi local
```

### 阿里云 / 腾讯云安全组配置

如果浏览器无法访问，检查云服务器安全组是否放行入站端口：

| 云平台 | 设置路径 | 规则 |
|--------|----------|------|
| 阿里云 | ECS 控制台 → 安全组 → 入方向规则 | 授权 0.0.0.0/0，TCP，端口 8080 |
| 腾讯云 | CVM 控制台 → 安全组 → 入站规则 | 授权 0.0.0.0/0，TCP，端口 8080 |

### 架构说明

```
客户端 → :8080 → Docker 容器
                   ├─ Gunicorn（主进程，管理 worker）
                   └─ Uvicorn Workers × N（处理 FastAPI 请求）
```

- 使用 **Gunicorn** 多进程管理，按 CPU 核数自动配置 worker 数量
- 使用 **非 root 用户** 运行，提高安全性
- `.env` 文件不在镜像内，通过 `docker-compose.yml` 的 `env_file` 在运行时注入
- 所有数据缓存在内存中，**服务重启后缓存清空**，下次请求会重新获取
