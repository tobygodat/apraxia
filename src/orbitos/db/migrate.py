"""Idempotent schema migration.

``migrate()`` runs the full ``schema.sql`` (all ``CREATE TABLE IF NOT EXISTS``)
on every boot — cheap and safe. A richer versioned-migration system is a later
add; v1 only ever grows the schema.
"""

from __future__ import annotations

from pathlib import Path

from orbitos.db.connection import get_connection

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def migrate() -> None:
    """Create any missing tables. Safe to call repeatedly."""
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    with get_connection() as conn:
        conn.executescript(schema)
