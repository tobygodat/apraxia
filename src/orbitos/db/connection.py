"""SQLite connection helpers.

A single SQLite file is the canonical store (spec §6). WAL mode lets the web
app read while the scanner/agent write. Rows come back as ``sqlite3.Row`` so
callers can index by column name.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

from orbitos.config import get_settings


def connect() -> sqlite3.Connection:
    """Open a connection with our standard pragmas (WAL + foreign keys)."""
    settings = get_settings()
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    """Yield a connection, committing on success and always closing."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
