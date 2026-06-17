"""Central application settings (spec §7).

Everything reads configuration from here via :func:`get_settings`, never from
``os.environ`` directly. Values come from the process environment and an optional
``.env`` file (see ``.env.example``).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Telegram (spec §7 step 4); optional so the app boots without a bot ---
    telegram_token: str | None = Field(default=None, alias="TELEGRAM_TOKEN")
    telegram_chat_id: str | None = Field(default=None, alias="TELEGRAM_CHAT_ID")

    # --- Anthropic API (spec §7 step 5); optional in dev ----------------------
    anthropic_api_key: str | None = Field(default=None, alias="ANTHROPIC_API_KEY")

    # --- Paths ----------------------------------------------------------------
    vault_path: Path = Field(default=Path("./vault"), alias="VAULT_PATH")
    db_path: Path = Field(default=Path("./tobios.db"), alias="DB_PATH")

    # --- Web auth (spec §9) ---------------------------------------------------
    # When app_password is unset, the auth gate is disabled (dev convenience).
    app_password: str | None = Field(default=None, alias="APP_PASSWORD")
    session_secret: str = Field(default="dev-insecure-change-me", alias="SESSION_SECRET")

    # --- Tuning (spec §7 step 8) ----------------------------------------------
    scan_interval_min: int = Field(default=15, alias="SCAN_INTERVAL_MIN")
    confidence_threshold: float = Field(default=0.75, alias="CONFIDENCE_THRESHOLD")

    # --- Web server -----------------------------------------------------------
    host: str = Field(default="127.0.0.1", alias="HOST")
    port: int = Field(default=8000, alias="PORT")
    env: Literal["development", "production"] = Field(default="development", alias="ENV")

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def auth_enabled(self) -> bool:
        return bool(self.app_password)


@lru_cache
def get_settings() -> Settings:
    """Return the cached singleton settings instance.

    Tests that mutate the environment should call ``get_settings.cache_clear()``.
    """
    return Settings()
