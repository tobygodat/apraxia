# Personal CRM — v1 Spec

A self-hosted personal CRM that scans your Obsidian daily notes, extracts structured items into a database, surfaces them in a web app, and runs a draft-only agent that texts you proposals over Telegram.

---

## 1. Decisions (locked)

| Decision | Choice |
|---|---|
| Source of truth | **Database-canonical.** Vault is a read-only input. Data flows one way: vault → DB. The web app reads/writes the DB only, never the vault. |
| Hosting | **Cloud VPS** (~$6/mo, e.g. Hetzner CX22 or DigitalOcean basic droplet). Always-on, single machine runs everything. |
| Vault → VPS sync | **Git.** Obsidian Git plugin auto-commits the vault on a timer; the VPS pulls on a schedule. |
| Texting channel | **Telegram bot** — free, inline Approve/Skip/Edit buttons, rich inline drafts. |
| Agent scope | **Draft-only.** Agent never touches the outside world. On approval it saves a draft you copy and send manually. No external credentials, no irreversible actions. |
| Sections | Todos, Writing, Books, Movies, **Drafts** (agent output). No People tracker in v1. |
| Extraction scope | **Daily notes only.** |

### Known v1 tradeoff
Items created *in the web app* live only in the DB, not your vault — so the vault stops being a complete picture. Accepted for v1. If it bothers you later, add an optional one-way "export to a dedicated CRM note." Out of scope now.

---

## 2. Data flow

```
Obsidian vault (Markdown)          Laptop
  daily notes ──┐
                │ Obsidian Git plugin auto-commits (timer)
                ▼
            git remote (private repo)
                │
                │ VPS pulls on schedule
                ▼
┌──────────────────────────────────────────────┐
│  VPS                                            │
│  vault/ (.md)                                   │
│     │ scanner (every 15 min, daily notes only)  │
│     ▼                                           │
│  extractor (LLM parse) ──upsert──▶ SQLite DB    │
│                                      │    ▲      │
│  agent loop (polls DB) ◀─────────────┘    │      │
│     │ proposes                            │      │
│     ▼                              web app (CRUD)│
│  Telegram bot ◀── you tap Approve/Skip/Edit      │
│     │ on Approve: writes draft to Drafts table   │
│     └──────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

---

## 3. Database schema (SQLite)

```sql
-- Extracted + manual items share tables; `source` distinguishes origin.

CREATE TABLE todos (
  id            INTEGER PRIMARY KEY,
  text          TEXT NOT NULL,
  done          INTEGER NOT NULL DEFAULT 0,
  due           TEXT,                      -- ISO date, nullable
  source        TEXT NOT NULL,             -- 'vault' | 'webapp'
  source_note   TEXT,                      -- e.g. '2026-06-16.md'
  dedupe_hash   TEXT UNIQUE,               -- stable hash, see §5
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE writing (
  id            INTEGER PRIMARY KEY,
  title         TEXT,
  body          TEXT NOT NULL,
  tags          TEXT,                      -- comma-sep or JSON
  source        TEXT NOT NULL,
  source_note   TEXT,
  dedupe_hash   TEXT UNIQUE,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE books (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  author        TEXT,
  status        TEXT NOT NULL DEFAULT 'to-read',  -- to-read|reading|read
  rating        INTEGER,                   -- 1-5, nullable
  notes         TEXT,
  source        TEXT NOT NULL,
  source_note   TEXT,
  dedupe_hash   TEXT UNIQUE,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE movies (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  year          INTEGER,
  status        TEXT NOT NULL DEFAULT 'to-watch', -- to-watch|watched
  rating        INTEGER,
  notes         TEXT,
  source        TEXT NOT NULL,
  source_note   TEXT,
  dedupe_hash   TEXT UNIQUE,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE drafts (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL,             -- 'message' | 'writing' | 'reply' | ...
  prompt        TEXT NOT NULL,             -- what the agent was asked to draft
  body          TEXT NOT NULL,             -- the draft itself
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|approved|skipped
  related_todo  INTEGER REFERENCES todos(id),
  created_at    TEXT NOT NULL
);

-- Tracks which notes have been scanned + their last-seen content hash,
-- so the scanner skips unchanged notes.
CREATE TABLE scan_state (
  note_path     TEXT PRIMARY KEY,
  content_hash  TEXT NOT NULL,
  last_scanned  TEXT NOT NULL
);

-- Proposals awaiting your Telegram decision.
CREATE TABLE proposals (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL,             -- 'todo'|'book'|'movie'|'writing'|'draft'
  payload       TEXT NOT NULL,             -- JSON of the proposed row
  confidence    REAL NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|approved|skipped
  tg_message_id INTEGER,                   -- so we can edit the message on decision
  created_at    TEXT NOT NULL
);
```

---

## 4. Components

### 4a. Scanner (scheduled, every ~15 min)
1. `git pull` the vault repo.
2. Find daily notes only (match your daily-note path/format, e.g. `Daily/YYYY-MM-DD.md`).
3. For each, hash the content; compare to `scan_state`. Skip unchanged.
4. Changed/new notes → hand to extractor.

### 4b. Extractor (LLM)
- Sends each changed daily note to the Anthropic API with a structured-output prompt: "Return JSON only. Classify each actionable/notable line as todo | book | movie | writing | none, with a confidence 0–1."
- For each returned item, compute `dedupe_hash` (§5) and check the relevant table + `proposals`.
- **Routing by confidence and type:**
  - High-confidence, low-risk (a book/movie title) → upsert directly into its table.
  - Anything actionable (todos) or ambiguous (confidence below threshold) → insert into `proposals` for Telegram approval.

### 4c. Agent loop (polls DB)
- Watches `proposals` (status=pending) and any todos flagged "agent could help" → sends a Telegram message with inline buttons.
- For draftable items (e.g. "reply to Derek about X"), calls the API to generate a draft and includes it inline.
- On **Approve** → writes to the real table (proposal) or to `drafts` (draft). On **Skip** → marks skipped. On **Edit** → prompts you for a tweak, regenerates.

### 4d. Telegram bot
- One bot, created via @BotFather. Long-polling or webhook.
- Inline keyboard: `[Approve] [Skip] [Edit]`. Edits the original message in place on decision so your chat stays clean.

### 4e. Web app (FastAPI + simple frontend)
- Pages: Todos, Writing, Books, Movies, Drafts.
- Full CRUD on the DB. Marks web-created rows `source='webapp'`.
- Drafts page = the outbox: read the agent's approved drafts, copy, send manually.

---

## 5. The two non-obvious problems

**Idempotency.** The scanner re-reads the same notes forever. Each extracted item gets a stable `dedupe_hash = sha256(source_note + normalized_line_text)`. Re-extraction does an **upsert on `dedupe_hash`**, never a blind insert — so editing a note updates the existing row instead of duplicating it. `scan_state` adds a second cheap guard: skip whole notes whose content hash hasn't changed.

**Confidence + approval as one mechanism.** Your "draft-only" rule and the "text me to approve" loop are the *same* gate. Nothing actionable enters your real tables without a Telegram yes. Structured low-risk facts (titles) can auto-file to keep the noise down. One tunable threshold controls how much routes to your phone vs. auto-files.

---

## 6. Suggested stack

- **Language:** Python 3.11+
- **Web:** FastAPI + Jinja templates (or a thin HTMX frontend — no build step)
- **Scheduling:** APScheduler (in-process; no separate cron)
- **DB:** SQLite (single file; trivially backed up by copying)
- **Telegram:** `python-telegram-bot`
- **LLM:** Anthropic API (extraction + drafting)
- **Process mgmt:** one `systemd` unit on the VPS
- **Vault sync:** Obsidian Git plugin (laptop) + scheduled `git pull` (VPS)

One process, one repo, one service. Minimal surface area to maintain solo.

---

## 7. Setup checklist (when you build)

1. Rent VPS; create a non-root user; install Python + git.
2. Make a **private** Git repo for your vault. Install Obsidian Git plugin; set auto-commit interval (e.g. 10 min). Push.
3. Clone the vault repo onto the VPS.
4. @BotFather → create bot → save token. Send your bot a message; grab your chat ID.
5. Get an Anthropic API key.
6. Deploy the app; set env vars (`TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `ANTHROPIC_API_KEY`, `VAULT_PATH`, `DB_PATH`).
7. `systemd` unit to keep it running + restart on boot.
8. Set scanner interval (15 min) and confidence threshold; tune after a few days of real notes.

---

## 8. Explicitly out of scope for v1

- Writing back to the vault (one-way only).
- People / relationship tracker.
- Scanning anything but daily notes.
- Agent doing external actions (sending, buying, deleting) — draft-only.
- Habit tracking, goals/projects, journal sentiment — easy adds once the spine works.

---

## 9. Security notes

- VPS: SSH keys only, disable password auth, enable a firewall (only SSH + the app port).
- Put the web app behind auth (even a single password) — it's on the public internet.
- API key and Telegram token in env vars / a secrets file, never in the repo.
- The vault repo is **private**. Daily notes are personal.
- Draft-only scope means a leaked Telegram token can't *do* anything beyond reading proposals — a real benefit of this design.
