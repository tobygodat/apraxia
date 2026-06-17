"""Find daily notes and decide which changed since last scan (spec §4a steps 2-3).

Daily notes only (spec §1, §8). A note is identified by a ``YYYY-MM-DD.md``
filename. The ``scan_state`` table stores each note's last-seen content hash so
unchanged notes are skipped cheaply before any LLM call.
"""

from __future__ import annotations

import hashlib
import re
from datetime import UTC, datetime
from pathlib import Path

from tobios.db.connection import get_connection

DAILY_NOTE_RE = re.compile(r"\d{4}-\d{2}-\d{2}\.md$")


def find_daily_notes(vault_path: Path) -> list[Path]:
    """Return all daily notes (``YYYY-MM-DD.md``) anywhere under the vault."""
    if not vault_path.exists():
        return []
    return sorted(p for p in vault_path.rglob("*.md") if DAILY_NOTE_RE.search(p.name))


def content_hash(path: Path) -> str:
    """SHA-256 of a note's raw bytes."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def note_changed(note_path: str, new_hash: str) -> bool:
    """True if this note is new or its content hash differs from ``scan_state``."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT content_hash FROM scan_state WHERE note_path = ?", (note_path,)
        ).fetchone()
    return row is None or row["content_hash"] != new_hash


def record_scan(note_path: str, new_hash: str) -> None:
    """Upsert the last-seen hash + timestamp for a note."""
    now = datetime.now(UTC).isoformat()
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO scan_state (note_path, content_hash, last_scanned) "
            "VALUES (?, ?, ?) "
            "ON CONFLICT(note_path) DO UPDATE SET "
            "content_hash = excluded.content_hash, last_scanned = excluded.last_scanned",
            (note_path, new_hash, now),
        )
