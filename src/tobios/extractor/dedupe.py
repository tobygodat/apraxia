"""Stable dedupe hashing (spec §5).

``dedupe_hash = sha256(source_note + normalized_line_text)``. Normalization
strips list bullets / checkboxes, collapses whitespace, and lowercases so that
trivial edits to a line don't spawn a duplicate row — re-extraction upserts on
this hash (see :func:`tobios.db.repo.upsert_by_dedupe_hash`).
"""

from __future__ import annotations

import hashlib
import re

_BULLET_RE = re.compile(r"^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s*)?")
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_line(text: str) -> str:
    """Normalize a note line so cosmetic differences hash identically."""
    stripped = _BULLET_RE.sub("", text.strip())
    return _WHITESPACE_RE.sub(" ", stripped).strip().lower()


def compute_dedupe_hash(source_note: str, line_text: str) -> str:
    """Return the stable 64-char hex hash for a line within a note."""
    normalized = normalize_line(line_text)
    return hashlib.sha256(f"{source_note}\n{normalized}".encode()).hexdigest()
