"""Telegram bot setup (spec §4d).

One bot via @BotFather, long-polling. Returns ``None`` when no token is
configured so the rest of the app runs without Telegram in dev.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from tobios.config import get_settings

if TYPE_CHECKING:
    from telegram.ext import Application

log = logging.getLogger(__name__)


def build_application() -> Application | None:
    """Build the python-telegram-bot Application, or None if no token."""
    settings = get_settings()
    if not settings.telegram_token:
        return None
    from telegram.ext import Application  # lazy: only needed when a bot runs

    from tobios.telegram.handlers import register_handlers

    application = Application.builder().token(settings.telegram_token).build()
    register_handlers(application)
    log.info("Telegram bot built")
    return application
