"""Telegram inline-keyboard handlers (spec §4c, §4d).

Approve / Skip / Edit on each proposal. On Approve → write to the real table
(or ``drafts``); on Skip → mark skipped; on Edit → prompt for a tweak and
regenerate. The message is edited in place so the chat stays clean.

STUB: handler registration is a no-op placeholder.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from telegram.ext import Application

log = logging.getLogger(__name__)


def register_handlers(application: Application) -> None:
    """Register command/callback handlers on the bot application."""
    # TODO(v1): application.add_handler(CallbackQueryHandler(on_decision))
    log.info("Telegram handlers registered (stub)")
