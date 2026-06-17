"""Draft generation (spec §4c).

For draftable items ("reply to Derek about X"), call the Anthropic API to
generate a draft shown inline in Telegram. On Approve it's written to the
``drafts`` table — the outbox you copy from. Draft-only: never sent (spec §1).

STUB: not implemented yet.
"""

from __future__ import annotations

import logging

from tobios.config import get_settings

log = logging.getLogger(__name__)


def generate_draft(prompt: str) -> str:
    """Generate a draft body for a prompt. Not implemented in v1 scaffold."""
    if not get_settings().anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is required to generate drafts")
    raise NotImplementedError("draft generation not implemented yet")
