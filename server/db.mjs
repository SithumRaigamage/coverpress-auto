/* SQLite schema and connection.

   node:sqlite ships with Node, so the product still runs on one runtime
   dependency (@napi-rs/canvas). Projects, covers, renders, art and the job queue
   all live here; every table that holds account data is reachable from an
   account_id, and every query in repo.mjs filters through it. Those columns stay
   in place while accounts are switched off so multi-user support is a routing
   change later, not a migration. */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'free',
  created_at    TEXT NOT NULL,
  disabled      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS provider_keys (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sealed     TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, name)
);

-- Non-secret preferences (Ollama host, model names). Scoped like every other
-- account-owned table so the isolation rule survives multi-user support.
CREATE TABLE IF NOT EXISTS settings (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (account_id, key)
);

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  platform   TEXT NOT NULL DEFAULT 'PS5',
  layout     TEXT NOT NULL DEFAULT 'auto',
  accent     TEXT NOT NULL DEFAULT '',
  mark       TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  edition    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_account ON projects(account_id);

CREATE TABLE IF NOT EXISTS covers (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  query       TEXT NOT NULL,
  platform    TEXT NOT NULL,
  mode        TEXT NOT NULL,             -- manual | auto
  status      TEXT NOT NULL,             -- queued|processing|auto_approved|needs_review|failed|approved|rejected
  error       TEXT NOT NULL DEFAULT '',
  meta        TEXT NOT NULL DEFAULT '',  -- JSON from RAWG
  copy        TEXT NOT NULL DEFAULT '',  -- JSON from the language model
  overrides   TEXT NOT NULL DEFAULT '',  -- JSON, reviewer tweaks
  qc          TEXT NOT NULL DEFAULT '',  -- JSON of the latest render
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  decided_at  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS covers_project ON covers(project_id);
CREATE INDEX IF NOT EXISTS covers_created ON covers(created_at);

CREATE TABLE IF NOT EXISTS art (
  cover_id   TEXT NOT NULL REFERENCES covers(id) ON DELETE CASCADE,
  slot       TEXT NOT NULL,              -- front | back | shot0..2
  path       TEXT NOT NULL,
  width      INTEGER NOT NULL DEFAULT 0,
  height     INTEGER NOT NULL DEFAULT 0,
  bytes      INTEGER NOT NULL DEFAULT 0,
  kind       TEXT NOT NULL DEFAULT 'upload', -- upload | fetched
  created_at TEXT NOT NULL,
  PRIMARY KEY (cover_id, slot)
);

CREATE TABLE IF NOT EXISTS renders (
  id         TEXT PRIMARY KEY,
  cover_id   TEXT NOT NULL REFERENCES covers(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  wrap_path  TEXT NOT NULL,
  front_path TEXT NOT NULL,
  qc         TEXT NOT NULL DEFAULT '',
  cfg        TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (cover_id, version)
);
CREATE INDEX IF NOT EXISTS renders_cover ON renders(cover_id);

CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,            -- build
  cover_id     TEXT NOT NULL REFERENCES covers(id) ON DELETE CASCADE,
  state        TEXT NOT NULL,            -- queued | running | done | failed
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after    TEXT NOT NULL,
  last_error   TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_pick ON jobs(state, run_after);
CREATE INDEX IF NOT EXISTS jobs_cover ON jobs(cover_id, state);

CREATE TABLE IF NOT EXISTS usage_events (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  ref        TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_account ON usage_events(account_id, kind, created_at);
`;

/* Additive columns for databases created before they existed. Each is
   nullable-with-default so an old row reads the same as a new one.

   covers.source  JSON — where the cover came from and which art was picked:
                  { rawgId, front: { url, source, kind, width, height } }.
   jobs.progress  JSON — the pipeline step list the run screen draws.
   jobs.log       JSON — timestamped log lines for the run screen.
   covers.approved_render_id  the version a reviewer approved ('' = latest).
   renders.meta   JSON — what went into this version (art, shots, seed, copy). */
const MIGRATIONS = [
  ["covers", "source", "TEXT NOT NULL DEFAULT ''"],
  ["covers", "approved_render_id", "TEXT NOT NULL DEFAULT ''"],
  ["renders", "meta", "TEXT NOT NULL DEFAULT ''"],
  ["jobs", "progress", "TEXT NOT NULL DEFAULT ''"],
  ["jobs", "log", "TEXT NOT NULL DEFAULT ''"],
  ["jobs", "started_at", "TEXT NOT NULL DEFAULT ''"],
  ["jobs", "finished_at", "TEXT NOT NULL DEFAULT ''"],
];

function migrate(db) {
  for (const [table, column, type] of MIGRATIONS) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export const nowIso = () => new Date().toISOString();

/** First instant of the current UTC month — the quota window. */
export function monthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}
