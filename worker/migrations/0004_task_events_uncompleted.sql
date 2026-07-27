-- Migration: admit the `uncompleted` stats event
-- Created: 2026-07-26
--
-- Reopening a completed task (the ✓ toggle, added alongside 0003) records an
-- `uncompleted` event so counters.completed stays NET across flips. The events
-- log is append-only and counters are derived by COUNT(*), so cancelling a
-- completion has to be its own row — there is no stored counter to decrement.
--
-- task_events, however, constrains event_type with a CHECK allow-list that
-- predates this. The insert therefore threw in production, and because
-- withTaskOperation saves tasks and stats concurrently (Promise.all), the task
-- write had ALREADY landed: the task really was reopened, the caller got a 500,
-- and the counters silently drifted. Widening the allow-list closes all three.
--
-- SQLite cannot ALTER a CHECK constraint, so this is a table rebuild.
--
-- It DESTROYS NOTHING. The original table is RENAMED to task_events_backup_0004
-- and left in place, rather than dropped — 2253 rows of history going back to
-- 2025-11 is not something to delete on the strength of a migration running
-- once. Verify the new table (row count, max(id), spot-check the tail), then
-- drop the backup by hand when you are satisfied:
--     DROP TABLE task_events_backup_0004;
--
-- Re-runnable: if the backup already exists this migration has already run, and
-- the CREATE/INSERT are both guarded.

-- Rebuild with the widened allow-list. Column order, types, defaults and the
-- AUTOINCREMENT id all match the original exactly — only the CHECK changes.
CREATE TABLE IF NOT EXISTS task_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_key TEXT NOT NULL,
  board_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('created', 'completed', 'edited', 'deleted', 'uncompleted')),
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  metadata TEXT
);

-- Explicit id copy preserves history order AND seeds sqlite_sequence from
-- max(id), so new events keep counting up rather than colliding with old rows.
INSERT INTO task_events_new (id, user_key, board_id, task_id, event_type, timestamp, metadata)
  SELECT id, user_key, board_id, task_id, event_type, timestamp, metadata FROM task_events;

-- Keep the original, renamed. Nothing is dropped by this migration.
ALTER TABLE task_events RENAME TO task_events_backup_0004;
ALTER TABLE task_events_new RENAME TO task_events;

-- Recreate all four indexes on the LIVE table.
--
-- The DROPs are load-bearing, not tidiness. In SQLite an index follows its table
-- through a rename, so after the rename above all four names are still taken by
-- the backup's copies — `CREATE INDEX IF NOT EXISTS` would match those, skip
-- silently, and leave the new task_events with no indexes at all while reporting
-- success. Drop them off the backup (a frozen copy nobody queries; an index is
-- derived data) and build them fresh here.
DROP INDEX IF EXISTS idx_user_board;
DROP INDEX IF EXISTS idx_user;
DROP INDEX IF EXISTS idx_timestamp;
DROP INDEX IF EXISTS idx_task;

CREATE INDEX idx_user_board ON task_events(user_key, board_id, timestamp DESC);
CREATE INDEX idx_user       ON task_events(user_key, timestamp DESC);
CREATE INDEX idx_timestamp  ON task_events(timestamp DESC);
CREATE INDEX idx_task       ON task_events(task_id, timestamp DESC);
