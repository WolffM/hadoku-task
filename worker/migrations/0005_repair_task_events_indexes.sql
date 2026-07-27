-- Migration: put task_events' indexes back on task_events
-- Created: 2026-07-26
--
-- Repairs 0004. That migration renamed the old table to task_events_backup_0004
-- and then tried to recreate the four indexes with CREATE INDEX IF NOT EXISTS —
-- but in SQLite an index FOLLOWS its table through a rename. All four names were
-- therefore still taken (by the backup's copies), IF NOT EXISTS matched them,
-- and the new task_events came out with ZERO indexes. Silent: the migration
-- reported success, and every stats read started scanning the whole table.
--
-- Index names are global, so the fix is to drop them off the backup (they index
-- a frozen safety copy nobody queries) and create them fresh on the live table.
-- Dropping an index destroys no data — it is derived, and rebuilt below.
--
-- 0004 has been corrected the same way for anyone applying it to a fresh DB;
-- running this afterwards is harmless (identical indexes, dropped and remade).

DROP INDEX IF EXISTS idx_user_board;
DROP INDEX IF EXISTS idx_user;
DROP INDEX IF EXISTS idx_timestamp;
DROP INDEX IF EXISTS idx_task;

CREATE INDEX idx_user_board ON task_events(user_key, board_id, timestamp DESC);
CREATE INDEX idx_user       ON task_events(user_key, timestamp DESC);
CREATE INDEX idx_timestamp  ON task_events(timestamp DESC);
CREATE INDEX idx_task       ON task_events(task_id, timestamp DESC);
