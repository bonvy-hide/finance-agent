"""API 路由集合"""

from fastapi import APIRouter

from app.api import bs_chart

# 汇总路由，main.py 只需 include 一次
router = APIRouter()
router.include_router(bs_chart.router)
