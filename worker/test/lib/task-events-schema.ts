/**
 * The REAL `task_events` schema, transcribed verbatim from production.
 *
 * This table predates the migration files in this repo — it was created by hand
 * in prod (`wrangler d1 execute`) and only ever mutated by migrations since. Its
 * original DDL therefore lives nowhere in this repo, and every harness used to
 * hand-roll its own approximation.
 *
 * That approximation omitted the CHECK constraint, and it cost us: the
 * `uncompleted` stats event shipped green through every local harness and then
 * threw a 500 in prod, because the real column rejects any event_type outside
 * its allow-list. A harness DB that is more permissive than prod does not verify
 * prod — it only verifies itself.
 *
 * So this is the PRE-migration shape, applied BEFORE the migrations run, exactly
 * as prod experienced it. Migration 0004 then rebuilds the table with a widened
 * allow-list — which means the harnesses now exercise that migration too,
 * instead of assuming it worked.
 *
 * Keep this IDENTICAL to prod's original. Read the live definition with
 *   wrangler d1 execute task-events --remote \
 *     --command "SELECT sql FROM sqlite_master WHERE name='task_events'"
 * (post-0004 it shows the widened CHECK; the shape below is what 0004 migrates
 * FROM).
 */

/**
 * task_events as it existed before migration 0004: the narrow CHECK allow-list
 * that rejected `uncompleted`, plus prod's four indexes.
 */
export const TASK_EVENTS_BASE_DDL = `
  CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_key TEXT NOT NULL,
    board_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('created', 'completed', 'edited', 'deleted')),
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    metadata TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_user_board ON task_events(user_key, board_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_user       ON task_events(user_key, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_timestamp  ON task_events(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_task       ON task_events(task_id, timestamp DESC);`
