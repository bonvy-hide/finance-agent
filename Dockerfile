FROM python:3.12-slim AS base

# 安装系统依赖（curl 用于健康检查）
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# 安装 uv（Python 包管理器）
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# 设置环境变量（uv 需要）
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

# 设置工作目录
WORKDIR /app

# 先复制依赖声明文件，利用 Docker 层缓存加速重复构建
COPY pyproject.toml uv.lock ./

# 仅下载依赖（不安装项目本身，代码变动时不用重新下载）
RUN uv sync --frozen --no-install-project

# 复制项目源码
COPY . .

# 安装项目本身
RUN uv sync --frozen

# 创建非 root 用户并设置权限
RUN groupadd -r appuser && useradd -r -g appuser -d /app appuser && \
    chown -R appuser:appuser /app

# 切换到非 root 用户
USER appuser

# 暴露端口
EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/ || exit 1

# 使用 gunicorn 启动（配置见 gunicorn.conf.py）
CMD ["uv", "run", "gunicorn", "-c", "gunicorn.conf.py", "main:app"]
