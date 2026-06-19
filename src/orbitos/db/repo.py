"""Data-access layer over the SQLite tables (spec §3).

Generic CRUD keyed by table name plus :func:`upsert_by_dedupe_hash`, the
idempotency primitive every extractor write goes through (spec §5). Web-created
rows are tagged ``source='webapp'`` automatically.

Table names are validated against an allow-list, so the f-string interpolation
of the table name is safe; all *values* are passed as bound parameters.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from orbitos.db.connection import get_connection

# Per-table user-writable columns. id / created_at / updated_at are managed here.
WRITABLE_COLUMNS: dict[str, list[str]] = {
    "todos": ["text", "done", "due", "source", "source_note", "dedupe_hash"],
    "writing": ["title", "body", "tags", "source", "source_note", "dedupe_hash"],
    "books": [
        "title", "author", "status", "rating", "notes",
        "source", "source_note", "dedupe_hash",
    ],
    "movies": [
        "title", "year", "status", "rating", "notes",
        "source", "source_note", "dedupe_hash",
    ],
}
HAS_CREATED_AT = {"todos", "writing", "books", "movies"}
HAS_UPDATED_AT = {"todos", "writing", "books", "movies"}


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _check_table(table: str) -> None:
    if table not in WRITABLE_COLUMNS:
        raise ValueError(f"Unknown or non-CRUD table: {table!r}")


def list_rows(table: str) -> list[dict[str, Any]]:
    _check_table(table)
    with get_connection() as conn:
        rows = conn.execute(f"SELECT * FROM {table} ORDER BY id DESC").fetchall()
    return [dict(r) for r in rows]


def get_row(table: str, row_id: int) -> dict[str, Any] | None:
    _check_table(table)
    with get_connection() as conn:
        row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,)).fetchone()
    return dict(row) if row else None


def create_row(table: str, data: dict[str, Any]) -> dict[str, Any]:
    _check_table(table)
    cols = WRITABLE_COLUMNS[table]
    payload = {k: v for k, v in data.items() if k in cols}
    if "source" in cols and not payload.get("source"):
        payload["source"] = "webapp"
    now = _now()
    if table in HAS_CREATED_AT:
        payload["created_at"] = now
    if table in HAS_UPDATED_AT:
        payload["updated_at"] = now

    keys = list(payload)
    placeholders = ", ".join("?" * len(keys))
    with get_connection() as conn:
        cur = conn.execute(
            f"INSERT INTO {table} ({', '.join(keys)}) VALUES ({placeholders})",
            [payload[k] for k in keys],
        )
        new_id = cur.lastrowid
    return get_row(table, new_id)  # type: ignore[return-value]


def update_row(table: str, row_id: int, data: dict[str, Any]) -> dict[str, Any] | None:
    _check_table(table)
    cols = WRITABLE_COLUMNS[table]
    payload = {k: v for k, v in data.items() if k in cols}
    if table in HAS_UPDATED_AT:
        payload["updated_at"] = _now()
    if not payload:
        return get_row(table, row_id)

    set_clause = ", ".join(f"{k} = ?" for k in payload)
    with get_connection() as conn:
        conn.execute(
            f"UPDATE {table} SET {set_clause} WHERE id = ?",
            [*payload.values(), row_id],
        )
    return get_row(table, row_id)


def delete_row(table: str, row_id: int) -> None:
    _check_table(table)
    with get_connection() as conn:
        conn.execute(f"DELETE FROM {table} WHERE id = ?", (row_id,))


def upsert_by_dedupe_hash(table: str, data: dict[str, Any]) -> dict[str, Any]:
    """Insert a row, or update the existing one with the same ``dedupe_hash``.

    This is the idempotency guarantee from spec §5: the scanner re-reads the
    same notes forever, so every extracted write upserts on the stable
    ``dedupe_hash`` instead of blind-inserting. ``created_at`` is preserved on
    update; ``updated_at`` is refreshed.
    """
    _check_table(table)
    cols = WRITABLE_COLUMNS[table]
    if "dedupe_hash" not in cols:
        raise ValueError(f"Table {table!r} has no dedupe_hash to upsert on")
    if not data.get("dedupe_hash"):
        raise ValueError("upsert_by_dedupe_hash requires a non-empty dedupe_hash")

    now = _now()
    # Only write columns actually provided, so NOT NULL columns with defaults
    # (e.g. todos.done) fall back to their default rather than getting NULL.
    values: dict[str, Any] = {k: v for k, v in data.items() if k in cols}
    if "source" in cols and not values.get("source"):
        values["source"] = "vault"
    if table in HAS_CREATED_AT:
        values["created_at"] = now
    if table in HAS_UPDATED_AT:
        values["updated_at"] = now

    # On conflict, refresh the written columns — except the dedupe key (the
    # match) and created_at (preserve the original insert time).
    update_cols = [k for k in values if k not in ("dedupe_hash", "created_at")]
    set_clause = ", ".join(f"{c} = excluded.{c}" for c in update_cols)

    keys = list(values)
    placeholders = ", ".join("?" * len(keys))
    with get_connection() as conn:
        conn.execute(
            f"INSERT INTO {table} ({', '.join(keys)}) VALUES ({placeholders}) "
            f"ON CONFLICT(dedupe_hash) DO UPDATE SET {set_clause}",
            [values[k] for k in keys],
        )
        row = conn.execute(
            f"SELECT * FROM {table} WHERE dedupe_hash = ?", (data["dedupe_hash"],)
        ).fetchone()
    return dict(row)
