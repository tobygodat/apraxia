"""Shared test fixtures: an isolated, migrated SQLite DB per test."""

from __future__ import annotations

from collections.abc import Iterator

import pytest


@pytest.fixture()
def settings_env(tmp_path, monkeypatch) -> Iterator[None]:
    """Point settings at a temp DB + a known password, with a fresh cache."""
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("APP_PASSWORD", "test-secret")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv("ENV", "development")

    from tobios.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def migrated(settings_env) -> Iterator[None]:
    """Create the schema in the temp DB."""
    from tobios.db.migrate import migrate

    migrate()
    yield


@pytest.fixture()
def client(migrated):
    """A FastAPI TestClient bound to the migrated temp DB (cookies persist)."""
    from fastapi.testclient import TestClient

    from tobios.web.app import create_app

    return TestClient(create_app())
