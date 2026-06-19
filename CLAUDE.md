# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

orbitOS is a self-hosted personal CRM. It scans Obsidian daily notes, extracts structured items into SQLite, surfaces them in a React web app, and runs a draft-only agent that texts proposals over Telegram. [SPEC.md](SPEC.md) is the authoritative design and locked-decisions doc — read it before changing behavior; code comments cite its sections (e.g. `§4b`, `§5`).

Current state: the structure and the spec's "spine" are implemented and tested; the LLM extractor, drafting agent, and Telegram handlers are typed stubs marked `TODO(v1)`.

## Commands

Backend uses **uv** (if `uv` isn't on PATH, use `python -m uv`):

```bash
uv sync                                   # create .venv, install package + deps
uv run python -m orbitos.main             # run the service (API on :8000)
uv run pytest                             # all tests
uv run pytest tests/test_repo.py::test_todo_crud_roundtrip   # single test
uv run ruff check         # lint  (ruff check --fix to autofix)
```

Frontend (Node 18+):

```bash
cd frontend
npm install
npm run dev          # Vite dev server on :5173, proxies /api -> :8000
npm run typecheck    # tsc --noEmit
npm run build        # emits frontend/dist
```

Production is one process: `cd frontend && npm run build`, then `ENV=production uv run python -m orbitos.main` (FastAPI serves `dist/` + the API). Deploy via systemd — see [deploy/DEPLOY.md](deploy/DEPLOY.md).

## Architecture — the big picture

**One process, one service** ([src/orbitos/main.py](src/orbitos/main.py)). FastAPI (uvicorn), APScheduler, and the Telegram bot all run in a single asyncio loop over one SQLite file. The bot is optional: without `TELEGRAM_TOKEN` it's skipped and the web + scheduler run alone. This wiring is the integration point to get right when touching startup.

**Database-canonical, vault is read-only.** Data flows one way: vault → DB. The web app reads/writes the DB only, never the vault. The ingest pipeline is `scanner/ → extractor/ → (db tables | proposals)`.

**Two non-obvious invariants the design hinges on (SPEC §5):**
1. *Idempotent re-extraction.* The scanner re-reads the same notes forever, so every extracted write goes through `repo.upsert_by_dedupe_hash()` keyed by `dedupe_hash = sha256(source_note + normalized_line)` ([extractor/dedupe.py](src/orbitos/extractor/dedupe.py)) — never a blind insert. `scan_state` is a second cheap guard that skips whole unchanged notes.
2. *Confidence + approval are one gate.* `extractor/route.py:route_item()` decides per item: high-confidence low-risk titles (book/movie) auto-file; everything actionable or low-confidence becomes a `proposals` row that must get a Telegram yes before entering a real table.

**Settings flow through `config.get_settings()`** (lru-cached `pydantic-settings`) — never read `os.environ` directly. Tests mutate env then call `get_settings.cache_clear()` (see [tests/conftest.py](tests/conftest.py)).

**Web layer is a generic CRUD surface.** [db/repo.py](src/orbitos/db/repo.py) is table-name-keyed CRUD with a `WRITABLE_COLUMNS` allow-list (this is also what makes the f-string table interpolation safe — values are always bound params). [web/routes/_crud.py](src/orbitos/web/routes/_crud.py) builds one router per section from that. Auth ([web/auth.py](src/orbitos/web/auth.py)) is a signed session cookie; **when `APP_PASSWORD` is unset the gate is disabled** (dev convenience), and `GET /api/me` returns 401 until login so the SPA knows to show its login screen.

## Gotchas

- **`web/routes/_crud.py` must NOT use `from __future__ import annotations`.** The factory passes Pydantic model classes as function arguments used directly as endpoint parameter annotations; FastAPI needs the real classes, not stringized annotations.
- **Stubs degrade gracefully, not loudly.** `extractor/llm.py` returns `[]` without `ANTHROPIC_API_KEY`, so the scan pipeline no-ops rather than crashing. Keep that contract when implementing — the app must always boot without secrets.
- **Route introspection:** FastAPI 0.137 / Starlette 1.3 keep included routers nested (an `_IncludedRouter` in `app.routes`), not flattened. To see the API surface use `app.openapi()["paths"]`, not `app.routes`.
- Enums are `StrEnum` (Python 3.11+); ruff enforces this.
