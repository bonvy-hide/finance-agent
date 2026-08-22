# AGENTS.md

Financial chart analysis platform (财务图表分析平台): upload Excel financial statements (balance sheets, stock reports) and auto-generate interactive charts. FastAPI backend + vanilla JS/Chart.js SPA + CLI tools. Chinese-language project — UI text, comments, docs, and commit messages are in Chinese.

## Commands

Package manager is `uv` (Python 3.12):

- `uv sync` — install dependencies
- `uv run uvicorn main:app --reload` — dev server at http://127.0.0.1:8000
- `uv add <package>` — add dependency (updates pyproject.toml + uv.lock)
- CLI: `uv run python finance/bs_chart.py <file.xlsx> -o ./outputs`; `uv run python scripts/convert_stock_data.py --input in.xls --output out.xlsx`

No test framework, no linter configured. `test_refactor.py` is an ad-hoc end-to-end script that starts a real server and hits the API — run it manually for verification.

## Architecture

Four-layer separation (deeper details in `CODEBUDDY.md` and `README.md` — read before touching core areas):

- `main.py` — entry layer: FastAPI app, static mount, router registration
- `app/` — web layer: `api/` (one APIRouter module per chart type), `schemas/` (Pydantic models), `services/` (upload handling, data cache), `core/` (path constants)
- `finance/` — algorithm layer: pure business logic, must NOT import FastAPI; each module is also a CLI entry. Known exception: `finance/stock_charts.py` imports `ChartResponse` from `app.schemas.chart`
- `static/` — frontend SPA: plain HTML/JS/CSS, no build step, Chart.js 4.x via pinned CDN links
- `scripts/` — thin CLI wrappers around `finance/`

Key patterns:

- Route registration chain: module router → `app/api/__init__.py` aggregates → `main.py` includes once
- All chart endpoints return the unified `ChartResponse` model (`app/schemas/chart.py`)
- `POST /api/normalize` caches normalized data in an in-process LRU (`app/services/data_store.py`, max 100 entries, thread-safe, lost on restart); the 6 `GET /api/charts/*` endpoints read via `data_id`. No database.
- Excel reading: openpyxl for `.xlsx`, xlrd for `.xls`

## Conventions

- Chinese comments/docstrings; extensive type hints; `TypedDict` for structured data (e.g. `NormalizedData`); `__all__` exports; UPPER_SNAKE_CASE constants; `_`-prefixed private helpers
- Absolute imports (`from app...`, `from finance...`); standalone scripts adjust `sys.path` themselves
- Frontend JS: IIFE + 'use strict', 4-space indent, DOM ids namespaced per page (e.g. `dropzoneBs`)

## Gotchas

- Windows is the primary dev environment; CLI `__main__` blocks reconfigure stdout to UTF-8 to avoid GBK encoding errors — keep that when editing
- Excel parsing auto-detects header rows/period columns; balance-sheet merge rules (`DEFAULT_RULES` in `finance/bs_chart.py`) sum source accounts first ("及"-named merged accounts replace only their own constituents) and only fall back to a same-named pre-computed row when the sum is 0 — don't reorder casually
- Stock normalize output carries `meta.quarterly` (True=single-quarter caliber, False=YTD cumulative); frontend ROE math switches on it — cumulative ROE values must never be summed as TTM
- Frontend has no bundler; CDN library versions are pinned in `static/index.html`
