-- Migration: Move boards + tasks from Workers KV into D1
-- Created: 2026-07-23
--
-- Why: a blob-per-board read-modify-write over an eventually consistent store
-- cannot express compare-and-swap (see docs/planning/agent-boards-design.md §3).
-- D1 gives real optimistic concurrency in one conditional statement, per-task
-- writes, queries, and a change feed.
--
-- One migration, ALL columns for ALL tranches (T1..T7), so the schema migrates
-- exactly once. Tranches beyond T1 (claims, shares) get their tables here now
-- even though the code that writes them lands later — an empty table is free.
--
-- These tables coexist with `task_events` (migration 0001) in the same `DB`
-- binding. They NEVER join to task_events on user: task_events.user_key is
-- deliberately masked to 50% (0001) and is collision-prone by construction.
-- The tables below key on the FULL stable user_id (the registry UUID stamped
-- from X-User-Id). See agent-boards-design.md §3.4 — the identity hazard.

-- ---------------------------------------------------------------------------
-- boards: one row per board. Per-board OCC via `version` (finally real, §2.2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS boards (
  user_id         TEXT    NOT NULL,                       -- full stable user_id, NOT masked
  id              TEXT    NOT NULL,                       -- client-supplied slug; NOT unique across users
  handle          TEXT    NOT NULL,                       -- ULID, globally unique: the API's board reference (§7.1)
  name            TEXT    NOT NULL,
  tags            TEXT    NOT NULL DEFAULT '[]',           -- JSON array; freeform boards only
  repo            TEXT,                                    -- which repo this board drives (automation)
  mode            TEXT    NOT NULL DEFAULT 'standard',     -- 'standard' | 'automation'
  schema_id       TEXT,                                    -- provider's label, stored verbatim (§5.1)
  schema_version  INTEGER,                                 -- provider's version, stored verbatim
  lanes           TEXT,                                    -- JSON: the provider's lane list, verbatim
  previous_config TEXT,                                    -- pre-activation snapshot, for deactivate
  version         INTEGER NOT NULL DEFAULT 1,              -- board-METADATA OCC (rename/reorder/pin), §2.2
  tasks_version   INTEGER NOT NULL DEFAULT 1,              -- this board's TASK-collection OCC counter.
                                                           -- Preserves withTaskOperation()'s per-board
                                                           -- version (TasksFile.version) that the whole-file
                                                           -- storage contract + Kate's If-Match depend on.
                                                           -- Independent of `version` so a task write never
                                                           -- bumps board-metadata OCC and vice versa.
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS boards_handle ON boards(handle);

-- board_meta: per-USER boards-collection OCC, one row per user. Preserves the
-- KV blob's top-level { version, updatedAt } byte-for-byte: in the whole-file
-- storage contract every board create/delete rewrites the whole collection, so
-- the collection version is the OCC unit the existing handlers + Kate's board
-- If-Match already use. Distinct from boards.version (per-BOARD OCC, reserved
-- for T2's per-board rename/reorder/pin writes).
CREATE TABLE IF NOT EXISTS board_meta (
  user_id    TEXT PRIMARY KEY,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT    NOT NULL
);

-- ---------------------------------------------------------------------------
-- tasks: one row per task. `notes` is the plan (§6); `tasks_updated` is the
-- change-feed cursor (§4.4) and costs no extra write.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  user_id    TEXT NOT NULL,
  board_id   TEXT NOT NULL,
  id         TEXT NOT NULL,                                -- ULID
  title      TEXT NOT NULL,
  notes      TEXT,                                         -- markdown body / the plan (§6)
  tag        TEXT,                                         -- space-separated, unchanged contract
  state      TEXT NOT NULL DEFAULT 'Active',               -- 'Active' | 'Completed' | 'Deleted'
  date       TEXT,                                         -- 'YYYY-MM-DD', UTC day
  start_time TEXT,
  end_time   TEXT,
  source     TEXT,
  source_id  TEXT,
  metadata   TEXT,                                         -- JSON
  created_at TEXT NOT NULL,
  updated_at TEXT,
  closed_at  TEXT,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS tasks_board   ON tasks(user_id, board_id, state);
CREATE INDEX IF NOT EXISTS tasks_updated ON tasks(user_id, updated_at, id);   -- change-feed cursor (§4.4)
CREATE UNIQUE INDEX IF NOT EXISTS tasks_source ON tasks(user_id, source, source_id)
  WHERE source IS NOT NULL;                                                    -- ingest-once, in the DB

-- ---------------------------------------------------------------------------
-- board_prefs: per-VIEWER board state (§7.2). Pinned selects the cold-load
-- hydration set (§5.5), so it must be per user-key, not on the board row —
-- otherwise a grantee pinning a shared board would rewrite the owner's top bar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS board_prefs (
  user_id  TEXT    NOT NULL,                               -- the viewer: owner or grantee
  owner_id TEXT    NOT NULL,                               -- board's owner, so a grantee can pin someone else's
  board_id TEXT    NOT NULL,
  pinned   INTEGER NOT NULL DEFAULT 0,                     -- top bar AND cold-load hydration set (§5.5)
  position INTEGER NOT NULL DEFAULT 0,                     -- order among pinned
  PRIMARY KEY (user_id, owner_id, board_id)
);
CREATE INDEX IF NOT EXISTS board_prefs_pinned ON board_prefs(user_id, pinned, position);

-- ---------------------------------------------------------------------------
-- board_shares: shared boards (§7). Grantee is another user key or a service
-- key (e.g. TenHands). Lands in T5; empty until then.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS board_shares (
  owner_user_id   TEXT NOT NULL,
  board_id        TEXT NOT NULL,
  grantee_user_id TEXT NOT NULL,                           -- another user key, or a service key
  level           TEXT NOT NULL,                           -- 'readonly' | 'contributor'
  created_at      TEXT NOT NULL,
  PRIMARY KEY (owner_user_id, board_id, grantee_user_id)
);
CREATE INDEX IF NOT EXISTS board_shares_grantee ON board_shares(grantee_user_id);

-- ---------------------------------------------------------------------------
-- task_claims: the CAS surface (§4.1). Lands in T7; empty until then.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_claims (
  user_id      TEXT NOT NULL,
  board_id     TEXT NOT NULL,
  task_id      TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  token        TEXT NOT NULL,                              -- opaque, server-minted
  claimed_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,                              -- server-assigned, always
  heartbeat_at TEXT NOT NULL,
  PRIMARY KEY (user_id, task_id)
);

-- ---------------------------------------------------------------------------
-- task_claim_log: display history, not a state store (§4). Lands in T7.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_claim_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  board_id   TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  ended_at   TEXT,
  ended_by   TEXT,                                         -- 'release' | 'expiry'
  outcome    TEXT                                          -- free text from the runner; we don't interpret it
);
CREATE INDEX IF NOT EXISTS task_claim_log_task ON task_claim_log(user_id, task_id, id);
