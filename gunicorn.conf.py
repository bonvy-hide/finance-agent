"""Gunicorn 生产环境配置

使用 uvicorn.UvicornWorker 运行 FastAPI ASGI 应用。
"""

import multiprocessing

# 绑定地址（容器内监听所有网卡）
bind = "0.0.0.0:8000"

# Worker 进程数（默认使用 CPU 核数，单核时设为 2）
workers = multiprocessing.cpu_count() if multiprocessing.cpu_count() > 1 else 2

# Worker 类：Uvicorn ASGI worker
worker_class = "uvicorn.workers.UvicornWorker"

# 单个 worker 最大处理的请求数，防止内存泄漏累积
max_requests = 1000
max_requests_jitter = 50

# 超时设置
timeout = 120
graceful_timeout = 30
keepalive = 5

# 预加载应用代码（master 进程加载后 fork worker，共享内存）
preload_app = True

# 日志级别
loglevel = "info"

# 访问日志输出到 stdout（docker logs 可查看）
accesslog = "-"
