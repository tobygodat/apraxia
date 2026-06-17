"""Request schemas for the JSON API (spec §4e).

Create/update bodies per resource. Responses are the plain ``dict`` rows from
:mod:`tobios.db.repo`. Server-managed columns (id, source, timestamps,
dedupe_hash) are intentionally not settable here.
"""

from __future__ import annotations

from pydantic import BaseModel


class LoginRequest(BaseModel):
    password: str


class TodoCreate(BaseModel):
    text: str
    due: str | None = None


class TodoUpdate(BaseModel):
    text: str | None = None
    done: int | None = None
    due: str | None = None


class WritingCreate(BaseModel):
    body: str
    title: str | None = None
    tags: str | None = None


class WritingUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    tags: str | None = None


class BookCreate(BaseModel):
    title: str
    author: str | None = None
    status: str = "to-read"
    rating: int | None = None
    notes: str | None = None


class BookUpdate(BaseModel):
    title: str | None = None
    author: str | None = None
    status: str | None = None
    rating: int | None = None
    notes: str | None = None


class MovieCreate(BaseModel):
    title: str
    year: int | None = None
    status: str = "to-watch"
    rating: int | None = None
    notes: str | None = None


class MovieUpdate(BaseModel):
    title: str | None = None
    year: int | None = None
    status: str | None = None
    rating: int | None = None
    notes: str | None = None


class DraftCreate(BaseModel):
    kind: str
    prompt: str
    body: str
    status: str = "pending"
    related_todo: int | None = None


class DraftUpdate(BaseModel):
    status: str | None = None
    body: str | None = None
