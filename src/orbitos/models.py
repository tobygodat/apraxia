"""Shared domain models and enums (spec §3, §4).

These mirror the SQLite tables in ``db/schema.sql``. The repository layer
(``db/repo.py``) returns plain ``dict`` rows; these models give the rest of the
codebase typed shapes for extractor output, proposals, and API responses.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel


class Source(StrEnum):
    VAULT = "vault"
    WEBAPP = "webapp"


class ItemKind(StrEnum):
    """What the extractor classifies a line as (spec §4b)."""

    TODO = "todo"
    BOOK = "book"
    MOVIE = "movie"
    WRITING = "writing"
    NONE = "none"


class ProposalStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    SKIPPED = "skipped"


class ExtractedItem(BaseModel):
    """One classified line returned by the LLM extractor (spec §4b)."""

    kind: ItemKind
    confidence: float
    payload: dict
    source_note: str


class Proposal(BaseModel):
    """A pending item awaiting a Telegram decision (spec §3 `proposals`)."""

    id: int
    kind: str
    payload: dict
    confidence: float
    status: ProposalStatus
    tg_message_id: int | None = None
    created_at: str
