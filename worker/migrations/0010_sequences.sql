-- Migration: exercise sequences — a shared library, board widgets, and a run log
-- Created: 2026-11-21
--
-- A SEQUENCE is an ordered list of exercises you play through: each node gets a
-- 5s countdown, then either a timer (timed) or a wait for "next" (manual).
--
-- THE LIBRARY IS SHARED. Exercises and sequences belong to whoever made them
-- (`owner_id`), and anyone guest tier and up can use anyone's. Only the owner
-- (or an admin) may change or delete one.
--
-- EDITS MAKE VERSIONS, never changes in place. Every save of an exercise or a
-- sequence is a new row in its *_versions table; the head row carries the
-- latest `version` for listing. A sequence version pins the exact exercise
-- version of each node, and a board widget pins the exact sequence version. So
-- an author editing (or deleting) their exercise cannot change anyone else's
-- workout under them: what you put on your board is what plays until you
-- choose to update it. That is what copies would have bought, without a
-- library full of duplicates.
--
-- DELETE IS SOFT (`deleted_at`): the item leaves the library, and every pinned
-- version still resolves. Only account erase removes rows (account-erase.ts),
-- and then only what nobody else's board or sequence depends on.
--
-- Additive and re-runnable (IF NOT EXISTS). It must reach prod D1 BEFORE the
-- worker that reads it: board deletion and account erase delete from these.

CREATE TABLE IF NOT EXISTS exercises (
  id          TEXT    NOT NULL PRIMARY KEY,   -- ULID
  owner_id    TEXT    NOT NULL,               -- creator's registry userId
  version     INTEGER NOT NULL,               -- latest version number
  name        TEXT    NOT NULL,               -- the latest version's, for listing/search
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  deleted_at  TEXT                            -- soft delete: hidden from the library
);
CREATE INDEX IF NOT EXISTS exercises_owner ON exercises(owner_id);
CREATE INDEX IF NOT EXISTS exercises_name ON exercises(deleted_at, name);

CREATE TABLE IF NOT EXISTS exercise_versions (
  exercise_id TEXT    NOT NULL,
  version     INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  image_key   TEXT,                           -- cdn.hadoku.me object key (sha256 + ext)
  edited_by   TEXT    NOT NULL,               -- owner, or the admin who edited it
  created_at  TEXT    NOT NULL,
  PRIMARY KEY (exercise_id, version)
);

CREATE TABLE IF NOT EXISTS sequences (
  id          TEXT    NOT NULL PRIMARY KEY,
  owner_id    TEXT    NOT NULL,
  version     INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS sequences_owner ON sequences(owner_id);
CREATE INDEX IF NOT EXISTS sequences_name ON sequences(deleted_at, name);

CREATE TABLE IF NOT EXISTS sequence_versions (
  sequence_id TEXT    NOT NULL,
  version     INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  edited_by   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  PRIMARY KEY (sequence_id, version)
);

-- One row per node of a sequence version. A table, not JSON, so "who depends on
-- this exercise" is a query (account erase keeps what others use).
CREATE TABLE IF NOT EXISTS sequence_nodes (
  sequence_id      TEXT    NOT NULL,
  version          INTEGER NOT NULL,
  position         INTEGER NOT NULL,          -- 0-based order in the sequence
  exercise_id      TEXT    NOT NULL,
  exercise_version INTEGER NOT NULL,          -- pinned
  mode             TEXT    NOT NULL,          -- 'timed' | 'manual'
  seconds          INTEGER,                   -- timed: the node's length; NULL on manual
  PRIMARY KEY (sequence_id, version, position)
);
CREATE INDEX IF NOT EXISTS sequence_nodes_exercise ON sequence_nodes(exercise_id);

-- A sequence on a board: a widget, keyed like trackers by the board OWNER.
CREATE TABLE IF NOT EXISTS board_sequences (
  user_id          TEXT    NOT NULL,          -- board owner
  board_id         TEXT    NOT NULL,
  id               TEXT    NOT NULL,          -- ULID
  sequence_id      TEXT    NOT NULL,
  sequence_version INTEGER NOT NULL,          -- pinned; "update" moves it to the head
  position         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS board_sequences_board ON board_sequences(user_id, board_id, position);
CREATE INDEX IF NOT EXISTS board_sequences_sequence ON board_sequences(sequence_id);

-- One play of a sequence, by whoever pressed play (`runner_id`). Board fields
-- are set when it was started from a board widget; NULL from the library.
CREATE TABLE IF NOT EXISTS sequence_runs (
  id               TEXT    NOT NULL PRIMARY KEY,
  runner_id        TEXT    NOT NULL,
  sequence_id      TEXT    NOT NULL,
  sequence_version INTEGER NOT NULL,
  node_count       INTEGER NOT NULL,          -- of that version, so "complete" needs no join
  board_owner_id   TEXT,
  board_id         TEXT,
  widget_id        TEXT,
  status           TEXT    NOT NULL DEFAULT 'active', -- 'active' | 'completed' | 'stopped'
  started_at       TEXT    NOT NULL,
  ended_at         TEXT
);
CREATE INDEX IF NOT EXISTS sequence_runs_runner ON sequence_runs(runner_id, started_at);
CREATE INDEX IF NOT EXISTS sequence_runs_widget ON sequence_runs(board_owner_id, board_id, widget_id, started_at);

-- Every node PLAY in a run, in order. A node played twice (back, then through
-- again) is two rows with the same position; a skipped one is a row with
-- outcome 'skipped'. So a run is complete exactly when every position has a
-- 'completed' row.
CREATE TABLE IF NOT EXISTS sequence_run_nodes (
  run_id           TEXT    NOT NULL,
  seq              INTEGER NOT NULL,          -- order within the run, 0-based
  position         INTEGER NOT NULL,          -- which node of the sequence
  exercise_id      TEXT    NOT NULL,
  exercise_version INTEGER NOT NULL,
  outcome          TEXT    NOT NULL,          -- 'completed' | 'skipped' | 'rewound' | 'stopped'
  active_ms        INTEGER NOT NULL,          -- time on the node after "Go!", pauses excluded
  started_at       TEXT    NOT NULL,
  ended_at         TEXT    NOT NULL,
  PRIMARY KEY (run_id, seq)
);

-- Exercise pictures uploaded through task (to cdn.hadoku.me). task forwards
-- them under its own service key, so this is task's only record of WHO sent
-- one: it is what the per-person daily cap counts.
CREATE TABLE IF NOT EXISTS library_uploads (
  user_id    TEXT NOT NULL,
  image_key  TEXT NOT NULL,
  at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS library_uploads_user ON library_uploads(user_id, at);
