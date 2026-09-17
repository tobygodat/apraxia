-- apraxia database schema (spec §3).
-- Verbatim from the spec, with IF NOT EXISTS so migrate() is idempotent.
-- Extracted + manual items share tables; `source` distinguishes origin.

CREATE TABLE IF NOT EXISTS todos (
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

CREATE TABLE IF NOT EXISTS writing (
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

CREATE TABLE IF NOT EXISTS books (
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

CREATE TABLE IF NOT EXISTS movies (
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

-- Tracks which notes have been scanned + their last-seen content hash,
-- so the scanner skips unchanged notes.
CREATE TABLE IF NOT EXISTS scan_state (
  note_path     TEXT PRIMARY KEY,
  content_hash  TEXT NOT NULL,
  last_scanned  TEXT NOT NULL
);

-- Proposals awaiting your Telegram decision.
CREATE TABLE IF NOT EXISTS proposals (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL,             -- 'todo'|'book'|'movie'|'writing'|'draft'
  payload       TEXT NOT NULL,             -- JSON of the proposed row
  confidence    REAL NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|approved|skipped
  tg_message_id INTEGER,                   -- so we can edit the message on decision
  created_at    TEXT NOT NULL
);
