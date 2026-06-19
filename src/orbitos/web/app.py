"""FastAPI application factory (spec §4e, §6).

Wires session auth, the ``/api`` routers, and — in production — serves the built
React SPA from ``frontend/dist`` so the whole thing stays one service. In dev,
CORS is opened for the Vite dev server (:5173) which proxies ``/api`` here.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from orbitos.config import get_settings
from orbitos.web import auth
from orbitos.web.routes import books, movies, todos, writing

log = logging.getLogger(__name__)

# repo root / frontend / dist  (this file: src/orbitos/web/app.py)
DIST_DIR = Path(__file__).resolve().parents[3] / "frontend" / "dist"


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="orbitOS", version="0.1.0")

    # https_only is left False so prod works behind a plain reverse proxy; put a
    # TLS terminator in front in production (see deploy/DEPLOY.md, spec §9).
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        same_site="lax",
        https_only=False,
    )
    if not settings.is_production:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    api = APIRouter(prefix="/api")
    api.include_router(auth.router)
    api.include_router(todos.router)
    api.include_router(writing.router)
    api.include_router(books.router)
    api.include_router(movies.router)

    @api.get("/health", tags=["meta"])
    def health() -> dict:
        return {"status": "ok"}

    app.include_router(api)

    if settings.is_production and DIST_DIR.exists():
        _mount_spa(app)
        log.info("Serving SPA from %s", DIST_DIR)
    elif settings.is_production:
        log.warning("ENV=production but %s is missing — run `npm run build`", DIST_DIR)

    return app


def _mount_spa(app: FastAPI) -> None:
    """Serve the built SPA: hashed assets from /assets, index.html for everything
    else (so client-side routes deep-link on refresh). /api/* is matched first."""
    assets = DIST_DIR / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        return FileResponse(DIST_DIR / "index.html")
