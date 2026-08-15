"""财务图表分析平台 — 应用入口

启动方式：
    uv run uvicorn main:app --reload
    或
    uv run python main.py

访问：
    http://127.0.0.1:8000
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from app.api import router as api_router
from app.core.config import STATIC_DIR


class NoCacheStaticMiddleware(BaseHTTPMiddleware):
    """静态文件禁用缓存，避免开发时刷新看不到改动"""

    async def dispatch(self, request, call_next):
        response: Response = await call_next(request)
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


app = FastAPI(title="财务图表分析平台", version="1.0.0")
app.add_middleware(NoCacheStaticMiddleware)

# ── 静态文件 ──────────────────────────────
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# ── API 路由 ──────────────────────────────
app.include_router(api_router)


# ── 页面路由 ──────────────────────────────
def _render_html(filename: str) -> HTMLResponse:
    """读取 static/ 下的 HTML 文件并返回（带 no-cache 头）"""
    html_path = STATIC_DIR / filename
    if not html_path.exists():
        raise HTTPException(status_code=404, detail=f"{filename} 不存在")
    return HTMLResponse(
        content=html_path.read_text(encoding="utf-8"),
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    """个股财报多维分析首页（单页应用，含资产负债表切换）"""
    return _render_html("index.html")


@app.get("/bs-chart", response_class=HTMLResponse)
async def bs_chart_page() -> HTMLResponse:
    """兼容旧链接，重定向到首页（资产负债表现在内联在首页单页中）"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
