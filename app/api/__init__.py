"""API 路由集合"""

from fastapi import APIRouter

from app.api import bs_chart, stock_normalize, stock_charts

# 汇总路由，main.py 只需 include 一次
router = APIRouter()
router.include_router(bs_chart.router)
router.include_router(stock_normalize.router)
router.include_router(stock_charts.router)
