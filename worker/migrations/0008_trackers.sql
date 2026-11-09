-- Migration: tracker boards — named counters/values and their entry log
-- Created: 2026-11-09
--
-- A tracker board is an ordinary `boards` row with mode = 'tracker'. Instead of
-- tasks it holds trackers: named things you count (pushups, glasses of water) or
-- measure (weight). Every change is an entry, so the board can show history and
-- per-day totals, and a later physical button is just another entry `source`.
--
-- Both tables key on the board OWNER's full user_id, like boards/tasks, and carry
-- board_id so deleting a board (d1-storage) and erasing an account
-- (account-erase.ts) cascade with one predicate each.
--
-- Additive and re-runnable (IF NOT EXISTS). It must reach prod D1 BEFORE the
-- worker that reads it: board deletion deletes from these tables.

CREATE TABLE IF NOT EXISTS trackers (
  user_id    TEXT    NOT NULL,                 -- board owner
  board_id   TEXT    NOT NULL,                 -- the owner's board slug
  id         TEXT    NOT NULL,                 -- ULID
  name       TEXT    NOT NULL,
  kind       TEXT    NOT NULL DEFAULT 'counter', -- 'counter' (entries add) | 'value' (entries set)
  unit       TEXT,                             -- free text label: 'kg', 'reps', 'glasses'
  value      REAL    NOT NULL DEFAULT 0,       -- current count, or the latest logged value
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS trackers_board ON trackers(user_id, board_id, position);

CREATE TABLE IF NOT EXISTS tracker_entries (
  user_id    TEXT NOT NULL,                    -- board owner
  board_id   TEXT NOT NULL,
  tracker_id TEXT NOT NULL,
  id         TEXT NOT NULL,                    -- ULID
  delta      REAL,                             -- counter: the change; NULL on a value entry
  value      REAL NOT NULL,                    -- the tracker's value once this entry applied
  source     TEXT NOT NULL DEFAULT 'web',      -- 'web' | 'api' | 'button'
  actor_id   TEXT,                             -- who wrote it (a grantee on a shared board)
  note       TEXT,
  at         TEXT NOT NULL,                    -- ISO timestamp
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS tracker_entries_tracker ON tracker_entries(user_id, tracker_id, at);
CREATE INDEX IF NOT EXISTS tracker_entries_board ON tracker_entries(user_id, board_id, at);
