-- Migration: trackers are a widget on any board, not a board type
-- Created: 2026-11-15
--
-- 0008 made a tracker board a `boards` row with mode = 'tracker'. Trackers are
-- now a widget any board can hold (keyed by board_id as before, so the
-- trackers and tracker_entries tables do not change). The board type goes:
-- an existing tracker board becomes a standard board, its trackers kept, and it
-- gets task lanes like any other board.
--
-- Idempotent. Apply it AFTER the worker that stops gating tracker routes on the
-- mode is live: the old worker answers 409 for a board that is no longer
-- 'tracker'. The new worker and frontend ignore the mode (an unknown mode renders
-- as standard), so until this runs the only trace is the stored string.

UPDATE boards SET mode = 'standard' WHERE mode = 'tracker';
