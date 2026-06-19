"""Confidence + type routing — the single approval gate (spec §4b, §5).

One tunable threshold decides what auto-files vs. what gets texted to you:

* ``none``                              → SKIP
* low-risk title (book/movie), conf ≥ T → AUTO  (upsert straight into its table)
* anything else (todos, writing, or any low-confidence item) → PROPOSE (Telegram)

Nothing actionable enters a real table without a Telegram yes.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from enum import StrEnum

from orbitos.config import get_settings
from orbitos.db import repo
from orbitos.db.connection import get_connection
from orbitos.extractor import llm
from orbitos.extractor.dedupe import compute_dedupe_hash

log = logging.getLogger(__name__)

LOW_RISK_TYPES = {"book", "movie"}
KIND_TO_TABLE = {"todo": "todos", "writing": "writing", "book": "books", "movie": "movies"}


class Route(StrEnum):
    AUTO = "auto"
    PROPOSE = "propose"
    SKIP = "skip"


def route_item(kind: str, confidence: float, threshold: float) -> Route:
    """Decide where an extracted item goes. Pure function — see module docstring."""
    if kind == "none":
        return Route.SKIP
    if kind in LOW_RISK_TYPES and confidence >= threshold:
        return Route.AUTO
    return Route.PROPOSE


def process_note(source_note: str, text: str) -> int:
    """Extract a note's items and file them. Returns how many were acted on."""
    threshold = get_settings().confidence_threshold
    acted = 0
    for item in llm.extract_items(text, source_note=source_note):
        kind = item.kind.value
        decision = route_item(kind, item.confidence, threshold)
        if decision is Route.SKIP:
            continue
        row = {
            **item.payload,
            "source": "vault",
            "source_note": source_note,
            "dedupe_hash": compute_dedupe_hash(source_note, _primary_text(item.payload)),
        }
        if decision is Route.AUTO:
            repo.upsert_by_dedupe_hash(KIND_TO_TABLE[kind], row)
        else:
            _insert_proposal(kind, row, item.confidence)
        acted += 1
    return acted


def _primary_text(payload: dict) -> str:
    return payload.get("text") or payload.get("title") or payload.get("body") or ""


def _insert_proposal(kind: str, payload: dict, confidence: float) -> None:
    now = datetime.now(UTC).isoformat()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO proposals (kind, payload, confidence, status, created_at) "
            "VALUES (?, ?, ?, 'pending', ?)",
            (kind, json.dumps(payload), confidence, now),
        )
