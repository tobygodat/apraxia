"""Agent poll loop (spec §4c).

Watches ``proposals`` (status=pending) and todos flagged "agent could help",
and sends each to Telegram with inline Approve/Skip/Edit buttons.

STUB: counts pending proposals; Telegram delivery is not implemented yet.
"""

from __future__ import annotations

import logging

from orbitos.db.connection import get_connection

log = logging.getLogger(__name__)


def poll_proposals() -> int:
    """Return the number of pending proposals (would be sent to Telegram)."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id FROM proposals WHERE status = 'pending'"
        ).fetchall()
    if rows:
        log.info("%d pending proposal(s); Telegram delivery not implemented yet", len(rows))
    # TODO(v1): for each pending proposal, send a Telegram message with an
    # inline keyboard and store tg_message_id (spec §4c/§4d).
    return len(rows)
