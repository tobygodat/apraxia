"""Single shared-password auth gate (spec §9).

A signed session cookie (Starlette ``SessionMiddleware``) marks a browser as
authenticated. When ``APP_PASSWORD`` is unset the gate is disabled (dev), so the
SPA and API are open locally. ``GET /api/me`` returns 401 until login, which the
SPA uses to decide whether to show its login screen.
"""

from __future__ import annotations

import secrets

from fastapi import APIRouter, HTTPException, Request

from orbitos.config import get_settings
from orbitos.web.schemas import LoginRequest

router = APIRouter(tags=["auth"])


def is_authenticated(request: Request) -> bool:
    settings = get_settings()
    if not settings.auth_enabled:
        return True
    return bool(request.session.get("authenticated"))


def require_auth(request: Request) -> None:
    """Dependency: 401 unless the request is authenticated."""
    if not is_authenticated(request):
        raise HTTPException(status_code=401, detail="Not authenticated")


@router.post("/login")
def login(body: LoginRequest, request: Request) -> dict:
    settings = get_settings()
    if settings.auth_enabled and not secrets.compare_digest(
        body.password, settings.app_password or ""
    ):
        raise HTTPException(status_code=401, detail="Invalid password")
    request.session["authenticated"] = True
    return {"ok": True}


@router.post("/logout")
def logout(request: Request) -> dict:
    request.session.clear()
    return {"ok": True}


@router.get("/me")
def me(request: Request) -> dict:
    if not is_authenticated(request):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"authenticated": True}
