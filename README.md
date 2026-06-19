# orbitOS

A self-hosted **personal CRM**. It scans your Obsidian daily notes, extracts
structured items into a SQLite database, surfaces them in a web app, and runs a
draft-only agent that texts you proposals over Telegram.

The full design and the locked v1 decisions live in [SPEC.md](SPEC.md). This
README covers the repo layout and how to run it.

> **Status: scaffold.** The structure, database, web API + SPA, and the spec's
> "spine" (idempotent upsert, confidence routing, scan-state) are implemented and
> tested. The LLM extractor, drafting agent, and Telegram handlers are typed
> stubs marked `TODO(v1)` — the app boots and the web CRUD works without them.

## Architecture

One process, one repo, one service (spec §6): a FastAPI JSON API, an APScheduler
job runner, and a Telegram bot all run in a single asyncio loop over one SQLite
file. Data flows one way — the vault is a read-only input; the database is canonical.

```
vault (git) ──pull──▶ scanner ──changed notes──▶ extractor ──┬─▶ tables   (auto-file, high-confidence titles)
                      (every 15m)                            └─▶ proposals ─▶ Telegram ─▶ approve ─▶ tables / drafts
                                                                                  ▲
                                          web app (React SPA + FastAPI CRUD) ─────┘ (reads/writes the DB)
```

## Repo layout

```
src/orbitos/         Python backend (the single service)
  main.py            entrypoint — wires web + scheduler + bot in one loop
  config.py          pydantic-settings; all env vars (spec §7)
  db/                schema.sql (spec §3), migrate, repo (upsert_by_dedupe_hash)
  scanner/           git pull, daily-note discovery, scan_state skip (spec §4a)
  extractor/         dedupe hash, confidence routing, LLM call (spec §4b, §5)
  agent/             proposal poll loop + draft generation (spec §4c)
  telegram/          bot + Approve/Skip/Edit handlers (spec §4d)
  web/               FastAPI app, session auth, /api CRUD routers (spec §4e)
frontend/            React + Vite + TS SPA (five pages: Todos/Writing/Books/Movies/Drafts)
tests/               pytest: dedupe, routing, repo, scanner, api
deploy/              systemd unit + DEPLOY.md (VPS bring-up, spec §7/§9)
```

## Quick start (development)

Two servers in dev: FastAPI on `:8000` and the Vite dev server on `:5173`, which
proxies `/api` to the backend (so it's one origin in the browser).

**Backend** (needs [uv](https://docs.astral.sh/uv/) and Python 3.11+):

```bash
uv sync                          # create .venv, install the package + deps
cp .env.example .env             # optional in dev; leave APP_PASSWORD blank to skip login
uv run python -m orbitos.main    # serves the API on http://127.0.0.1:8000
```

**Frontend** (needs Node 18+):

```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

Open `http://localhost:5173`. With `APP_PASSWORD` unset the auth gate is disabled;
set it to require a password.

## Production

The SPA is built to static files and served by FastAPI, so prod is a single
service (spec §6):

```bash
cd frontend && npm run build     # emits frontend/dist
ENV=production uv run python -m orbitos.main   # FastAPI serves dist/ + the API
```

Run it under systemd on a VPS — see [deploy/DEPLOY.md](deploy/DEPLOY.md) for the
full checklist (vault git sync, secrets, firewall, TLS).

## Configuration

All settings are environment variables read by [config.py](src/orbitos/config.py);
see [.env.example](.env.example) for the annotated list. Key ones:

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | LLM extraction + drafting (blank → those steps no-op) |
| `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID` | the approval bot (blank → bot disabled) |
| `VAULT_PATH`, `DB_PATH` | vault checkout + the canonical SQLite file |
| `APP_PASSWORD`, `SESSION_SECRET` | single-password web auth (spec §9) |
| `SCAN_INTERVAL_MIN`, `CONFIDENCE_THRESHOLD` | scan cadence + auto-file vs. propose tuning |
| `ENV` | `development` (CORS for Vite) or `production` (serve `dist/`) |

## Testing & linting

```bash
uv run pytest          # backend tests
uv run ruff check      # lint
cd frontend && npm run typecheck && npm run build
```
