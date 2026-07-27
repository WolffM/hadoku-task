-- Migration: retain closed tasks instead of destroying them
-- Created: 2026-07-26
--
-- Completing a task used to splice it out of the tasks file, which made the next
-- whole-file write hard-DELETE its row — `state` and `closed_at` were columns
-- nothing ever read back. Tasks are now retained in every state, visibility is
-- decided on read (Active always; Completed for a 24h grace window, after which
-- it is "closed"), and the tasks table doubles as the retrospective archive.
--
-- Two index changes follow from that.

-- ---------------------------------------------------------------------------
-- 1. tasks_source must only constrain LIVE tasks.
--
-- The ingest-once guarantee is "one ACTIVE task per external event", not "one
-- row ever". With closed rows retained, a completed calendar task would occupy
-- (user_id, source, source_id) for good and every re-ingest of that event would
-- fail the constraint — the provider could never re-add a meeting you finished.
-- Rebuild the partial index to cover Active rows only.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS tasks_source;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_source ON tasks(user_id, source, source_id)
  WHERE source IS NOT NULL AND state = 'Active';

-- ---------------------------------------------------------------------------
-- 2. Retrospective reads ("what did I close, and when") sort by closed_at over a
-- table that now grows monotonically. Without this they degrade to a full scan
-- as history accumulates. Partial: Active rows have no closed_at and would just
-- bloat the index.
--
-- NOTE: this is the CONTENT half of a retrospective. The timeline half lives in
-- task_events, and the two cannot be joined — task_events.user_key is masked to
-- 50% by design (see 0002's header, the identity hazard), while tasks.user_id is
-- the full registry UUID. Query one or the other, never a join across them.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS tasks_closed ON tasks(user_id, closed_at)
  WHERE closed_at IS NOT NULL;
