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

from app.api import router as api_router
from app.core.config import STATIC_DIR

app = FastAPI(title="财务图表分析平台", version="1.0.0")

# ── 静态文件 ──────────────────────────────
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# ── API 路由 ──────────────────────────────
app.include_router(api_router)


# ── 页面路由 ──────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    """返回前端首页"""
    html_path = STATIC_DIR / "index.html"
    if not html_path.exists():
        raise HTTPException(status_code=404, detail="index.html 不存在")
    return HTMLResponse(content=html_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
