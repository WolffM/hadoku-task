/**
 * D1-backed storage adapter for @wolffm/task — the sole boards/tasks store.
 *
 * Implements the whole-file `TaskStorage` interface, so handlers, routes and MCP
 * are unchanged — the storage engine is invisible above this seam
 * (agent-boards-design.md §3.5). What D1 gives over the old KV blob:
 *   - real per-board board-metadata OCC (a conditional UPDATE, not a read-check),
 *   - a foundation for scoped hydration + a change feed (later tranches),
 *   - atomic multi-row writes via db.batch().
 *
 * The KV→D1 cutover is complete: there is no KV read-repair here any more. A
 * brand-new user is scaffolded by ensureInitialized() (board_meta + default
 * board), and every board/task read and write goes straight to D1.
 *
 * `legacyId` (the pre-userId-flip raw-credential namespace) is still threaded
 * through for the STATS path only, which dual-reads masked-key D1 event rows —
 * that is a D1 concern, unrelated to the retired KV boards/tasks store.
 */
import type {
  TaskStorage,
  UserType,
  TasksFile,
  StatsFile,
  BoardsFile,
  Board,
  Task
} from '@wolffm/task/api'
import { TaskUtils } from '@wolffm/task/api'
import {
  VersionConflictError,
  DuplicateSourceError,
  completedCutoff,
  parseStoredStatus
} from '@wolffm/task/api'
import { DEFAULT_BOARD_ID, DEFAULT_BOARD_NAME } from '../constants'
import {
  getBoardStats as getD1BoardStats,
  getBoardTimeline,
  deleteBoardEvents,
  logTaskEvents,
  tallyEvents,
  TIMELINE_LIMIT
} from '../events'
import { maskKey } from '@wolffm/worker-utils'
import type { Env } from '../types'

/**
 * "Still on the board", in SQL. Active always; Completed until its grace window
 * elapses. Deleted never. Binds ONE parameter — the cutoff from
 * completedCutoff() — and must be kept identical between the read (getTasks) and
 * the reconcile scan in saveTasks/batchSaveTasks; see the note there for why.
 * Served by the tasks_board(user_id, board_id, state) index.
 */
const VISIBLE_PREDICATE = `(state = 'Active' OR (state = 'Completed' AND closed_at > ?))`

// D1 is bound as `env.DB`; type it loosely to avoid a hard workers-types dep here.
interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      run(): Promise<{ meta: { changes: number } }>
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
      first<T = unknown>(col?: string): Promise<T | null>
    }
  }
  batch(statements: Array<{ run(): Promise<unknown> }>): Promise<unknown>
}

/** A D1 row from the `tasks` table. */
interface TaskRow {
  id: string
  title: string
  notes: string | null
  tag: string | null
  state: string
  date: string | null
  start_time: string | null
  end_time: string | null
  source: string | null
  source_id: string | null
  metadata: string | null
  status: string | null
  created_at: string
  updated_at: string | null
  closed_at: string | null
}

/** A D1 row from the `boards` table (metadata only — no tasks nested). */
interface BoardRow {
  id: string
  name: string
  tags: string | null
  mode: string
  repo: string | null
  // Automation (§5): the provider's lane set + opaque contract labels.
  lanes: string | null
  schema_id: string | null
  schema_version: number | null
  version: number
  tasks_version: number
  handle: string
  // Sharing (§7): the board's owner and THIS viewer's access level.
  owner_user_id: string
  access: 'owner' | 'contributor' | 'readonly'
  // From the board_prefs LEFT JOIN (COALESCEd, so always present on read).
  pinned: number
  position: number
  // Trackers on the board (a correlated count; GET /boards only).
  tracker_count?: number
}

function rowToTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes ?? null,
    tag: r.tag ?? null,
    state: r.state as Task['state'],
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? null,
    closedAt: r.closed_at ?? null,
    date: r.date ?? null,
    startTime: r.start_time ?? null,
    endTime: r.end_time ?? null,
    source: r.source ?? null,
    sourceId: r.source_id ?? null,
    metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : null,
    status: parseStoredStatus(r.status)
  }
}

function rowToBoard(r: BoardRow): Board {
  return {
    // A shared board is addressed by its globally-unique `handle`, never the
    // owner's slug: a slug only ever resolves within the CALLER's namespace
    // (the sharing security invariant), so if the viewer routed task ops by the
    // owner's slug they'd hit their own empty board. Own boards keep the slug.
    id: r.access !== 'owner' && r.handle ? r.handle : r.id,
    name: r.name,
    tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
    tasks: [], // metadata only; the handler fans out getTasks per board (§5.5)
    pinned: r.pinned === 1,
    position: r.position,
    mode: r.mode,
    handle: r.handle,
    ownerUserId: r.owner_user_id,
    access: r.access,
    // Automation (§5): lanes present only on automation boards.
    lanes: r.lanes ? (JSON.parse(r.lanes) as Board['lanes']) : null,
    repo: r.repo ?? null,
    schemaId: r.schema_id ?? null,
    schemaVersion: r.schema_version ?? null,
    // Lets the client load the tracker widgets only on a board that has some.
    ...(r.tracker_count ? { trackerCount: r.tracker_count } : {})
  }
}

const nowIso = () => new Date().toISOString()
const newHandle = () => TaskUtils.generateULID()

/** A deleted board takes its trackers and their history with it. */
const trackerDeletes = (db: D1Like, uid: string, boardId: string) => [
  db.prepare('DELETE FROM tracker_entries WHERE user_id = ? AND board_id = ?').bind(uid, boardId),
  db.prepare('DELETE FROM trackers WHERE user_id = ? AND board_id = ?').bind(uid, boardId)
]

/** The task columns every task read selects, in rowToTask's shape. */
const TASK_COLUMNS = `id, title, notes, tag, state, date, start_time, end_time, source, source_id,
                  metadata, status, created_at, updated_at, closed_at`

type CountRow = { board_id: string; event_type: string; count: number }
type EventRow = { board_id: string; task_id: string; event_type: string; timestamp: string }

type BoundStmt = ReturnType<ReturnType<D1Like['prepare']>['bind']>

function statsFile(counters: StatsFile['counters'], timeline: StatsFile['timeline']): StatsFile {
  return { version: 2, counters, timeline, tasks: {}, updatedAt: nowIso() }
}

function toTimeline(rows: Array<{ task_id: string; event_type: string; timestamp: string }>) {
  return rows.map(r => ({
    t: r.timestamp,
    event: r.event_type as 'created' | 'completed' | 'edited' | 'deleted',
    id: r.task_id
  }))
}

/** Group rows by a key, keeping each group in row order. */
function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const g = out.get(k)
    if (g) g.push(r)
    else out.set(k, [r])
  }
  return out
}

export function createD1Storage(env: Env, legacyId?: string): TaskStorage {
  const db = env.DB as unknown as D1Like

  /**
   * Several reads in ONE D1 round trip. From an edge isolate each round trip is
   * ~75ms (the D1 primary is not where the user is), so GET /boards' cost is
   * its count of SERIAL round trips — not its query count. Rows per statement,
   * in order.
   */
  async function readBatch(stmts: BoundStmt[]): Promise<unknown[][]> {
    const res = (await db.batch(stmts)) as Array<{ results?: unknown[] }>
    return res.map(r => r.results ?? [])
  }

  /**
   * Board contents getBoards already read, for the per-board getTasks/getStats
   * calls TaskHandlers.getBoards fans out right after it. Each entry is used
   * once, and every write drops them all, so nothing here can outlive the read
   * it came from. Without this, GET /boards was ~7 serial round trips (~600ms);
   * with it, one.
   */
  const prefetchedTasks = new Map<string, TasksFile>()
  const prefetchedStats = new Map<string, StatsFile>()
  const dropPrefetched = () => {
    prefetchedTasks.clear()
    prefetchedStats.clear()
  }
  const takePrefetched = <T>(m: Map<string, T>, key: string): T | undefined => {
    const v = m.get(key)
    m.delete(key)
    return v
  }

  let initializedFor: string | undefined

  /**
   * Ensure a user's D1 scaffolding exists before a read/write. Fast no-op once
   * board_meta is present. For a brand-new user it creates the collection-version
   * row and the default `main` board row (so getTasks has a tasks_version home and
   * getBoards shows the default board) — the same materialisation the KV→D1
   * migration used to do, minus the KV read now that the cutover is complete.
   */
  async function ensureInitialized(sessionId: string | undefined): Promise<void> {
    const uid = sessionId ?? 'public'
    if (initializedFor === uid) return
    const exists = await db
      .prepare('SELECT 1 AS ok FROM board_meta WHERE user_id = ?')
      .bind(uid)
      .first<number>('ok')
    if (exists === 1) {
      initializedFor = uid
      return
    }
    const ts = nowIso()
    await db.batch([
      db
        .prepare('INSERT OR IGNORE INTO board_meta (user_id, version, updated_at) VALUES (?, 1, ?)')
        .bind(uid, ts),
      db
        .prepare(
          `INSERT OR IGNORE INTO boards
             (user_id, id, handle, name, tags, mode, version, tasks_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, '[]', 'standard', 1, 1, ?, ?)`
        )
        .bind(uid, DEFAULT_BOARD_ID, newHandle(), DEFAULT_BOARD_NAME, ts, ts)
    ])
    initializedFor = uid
  }

  return {
    // --- Boards ----------------------------------------------------------
    async getBoards(_userType: UserType, sessionId?: string): Promise<BoardsFile> {
      const uid = sessionId ?? 'public'
      const userKey = sessionId ? maskKey(sessionId) : 'public'
      // Pre-userId-flip event rows live under the legacy key; getStats falls
      // back to them for a board with none under the current one. Read both here.
      const legacyKey = legacyId ? maskKey(legacyId) : undefined
      const eventKeys = legacyKey && legacyKey !== userKey ? [userKey, legacyKey] : [userKey]
      // LEFT JOIN board_prefs for this viewer's pin/position state (§7.2). For
      // own boards owner_id = uid; the join stays correct when T5 adds shared
      // boards (a grantee pins under the sharer's owner_id). COALESCE so a board
      // with no pref row reads as unpinned (0,0). Pinned first, then by position,
      // then stable by creation — so the top bar order is deterministic.
      // Owned boards UNION boards shared with this viewer (§7.1). Both carry the
      // owner id + this viewer's access level, and both join board_prefs keyed by
      // the VIEWER (§7.2) so a grantee's pins are their own. Pinned-first order is
      // stable across the union.
      //
      // Everything the handler's per-board fan-out would read — every owned
      // board's visible tasks, event counts and recent timeline — comes back in
      // the SAME batch, and is handed to those reads through the prefetch maps.
      const read = () =>
        readBatch([
          db.prepare('SELECT version, updated_at FROM board_meta WHERE user_id = ?').bind(uid),
          db
            .prepare(
              `SELECT b.id, b.name, b.tags, b.mode, b.repo, b.lanes, b.schema_id, b.schema_version,
                  b.version, b.tasks_version, b.handle,
                  b.user_id AS owner_user_id, 'owner' AS access,
                  COALESCE(p.pinned, 0)   AS pinned,
                  COALESCE(p.position, 0) AS position,
                  (SELECT COUNT(*) FROM trackers t
                    WHERE t.user_id = b.user_id AND t.board_id = b.id) AS tracker_count
             FROM boards b
             LEFT JOIN board_prefs p
               ON p.user_id = ? AND p.owner_id = b.user_id AND p.board_id = b.id
            WHERE b.user_id = ?
           UNION ALL
           SELECT b.id, b.name, b.tags, b.mode, b.repo, b.lanes, b.schema_id, b.schema_version,
                  b.version, b.tasks_version, b.handle,
                  b.user_id AS owner_user_id, s.level AS access,
                  COALESCE(p.pinned, 0)   AS pinned,
                  COALESCE(p.position, 0) AS position,
                  (SELECT COUNT(*) FROM trackers t
                    WHERE t.user_id = b.user_id AND t.board_id = b.id) AS tracker_count
             FROM board_shares s
             JOIN boards b ON b.user_id = s.owner_user_id AND b.id = s.board_id
             LEFT JOIN board_prefs p
               ON p.user_id = ? AND p.owner_id = b.user_id AND p.board_id = b.id
            WHERE s.grantee_user_id = ?
            ORDER BY pinned DESC, position ASC, owner_user_id, id`
            )
            .bind(uid, uid, uid, uid),
          db
            .prepare(
              `SELECT board_id, ${TASK_COLUMNS}
                 FROM tasks WHERE user_id = ? AND ${VISIBLE_PREDICATE}
                 ORDER BY created_at, id`
            )
            .bind(uid, completedCutoff()),
          ...eventKeys.flatMap(key => [
            db
              .prepare(
                `SELECT board_id, event_type, COUNT(*) AS count
                   FROM task_events WHERE user_key = ?
                  GROUP BY board_id, event_type`
              )
              .bind(key),
            db
              .prepare(
                `SELECT board_id, task_id, event_type, timestamp FROM (
                   SELECT board_id, task_id, event_type, timestamp,
                          ROW_NUMBER() OVER (PARTITION BY board_id ORDER BY timestamp DESC) AS rn
                     FROM task_events WHERE user_key = ?)
                  WHERE rn <= ?
                  ORDER BY board_id, timestamp DESC`
              )
              .bind(key, TIMELINE_LIMIT)
          ])
        ])
      let rows = await read()
      // A brand-new user: scaffold board_meta + the default board, then re-read.
      if (rows[0].length === 0) {
        await ensureInitialized(sessionId)
        rows = await read()
      }
      initializedFor = uid
      const [metaRows, boardRows, taskRows, ...eventRows] = rows as [
        Array<{ version: number; updated_at: string }>,
        BoardRow[],
        Array<TaskRow & { board_id: string }>,
        ...Array<Array<{ board_id: string } & Partial<EventRow & CountRow>>>
      ]

      const tasksByBoard = groupBy(taskRows, r => r.board_id)
      // Per event key (current, then legacy): counts and timeline by board.
      const eventsByKey = eventKeys.map((_, i) => ({
        counts: groupBy(eventRows[2 * i] as CountRow[], r => r.board_id),
        timeline: groupBy(eventRows[2 * i + 1] as EventRow[], r => r.board_id)
      }))
      dropPrefetched()
      for (const r of boardRows) {
        // A shared board's rows live under its OWNER's id, so the viewer-scoped
        // reads the handler makes for it are empty by definition (the route
        // re-hydrates it from the owner's scope). Hand them that empty answer
        // without a round trip.
        const own = r.access === 'owner'
        const key = own ? r.id : r.handle
        prefetchedTasks.set(key, {
          version: own ? (r.tasks_version ?? 1) : 1,
          updatedAt: nowIso(),
          tasks: own ? (tasksByBoard.get(r.id) ?? []).map(rowToTask) : []
        })
        // getStats' dual-read: the first key with any rows for this board.
        const events = (own &&
          eventsByKey.find(k => k.counts.has(r.id) || k.timeline.has(r.id))) || {
          counts: new Map<string, CountRow[]>(),
          timeline: new Map<string, EventRow[]>()
        }
        prefetchedStats.set(
          key,
          statsFile(
            tallyEvents(events.counts.get(r.id) ?? []),
            toTimeline(events.timeline.get(r.id) ?? [])
          )
        )
      }

      const meta = metaRows[0]
      const boards = boardRows.length
        ? boardRows.map(rowToBoard)
        : [{ id: DEFAULT_BOARD_ID, name: DEFAULT_BOARD_NAME, tags: [], tasks: [] }]
      return {
        version: (meta?.version ?? 1) as 1,
        updatedAt: meta?.updated_at ?? nowIso(),
        boards
      }
    },

    async saveBoards(
      _userType: UserType,
      boards: BoardsFile,
      sessionId?: string,
      expectedVersion?: number
    ): Promise<void> {
      dropPrefetched()
      await ensureInitialized(sessionId)
      const uid = sessionId ?? 'public'
      const ts = nowIso()

      // Board-metadata collection OCC (§2.2). When the caller opted in via
      // If-Match, bump conditionally so two concurrent writers can't both win —
      // the loser sees changes===0 and gets a 409. Absent ⇒ last-write-wins,
      // unchanged from KV (the web client never sends If-Match for boards).
      if (expectedVersion !== undefined) {
        const res = await db
          .prepare(
            'UPDATE board_meta SET version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?'
          )
          .bind(ts, uid, expectedVersion)
          .run()
        if (res.meta.changes === 0) {
          const current = await db
            .prepare('SELECT version FROM board_meta WHERE user_id = ?')
            .bind(uid)
            .first<number>('version')
          throw new VersionConflictError(current ?? 1)
        }
      } else {
        await db
          .prepare(
            `INSERT INTO board_meta (user_id, version, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET version = version + 1, updated_at = excluded.updated_at`
          )
          .bind(uid, boards.version ?? 1, ts)
          .run()
      }

      // Reconcile board rows to match the file. Existing boards keep their
      // handle/version/tasks_version; removed boards (and their tasks) are
      // deleted; new boards get a fresh handle. One atomic batch.
      //
      // A GET /boards response also carries boards SHARED with this viewer
      // (owned by someone else). Those must never touch this viewer's namespace
      // — reconciling them would clone a phantom copy on insert and, on the
      // delete pass, is simply not ours to remove. Filter to the viewer's own
      // boards (ownerUserId absent ⇒ a fresh/local board, i.e. ours).
      const ownBoards = boards.boards.filter(b => !b.ownerUserId || b.ownerUserId === uid)
      const existing = await db
        .prepare('SELECT id FROM boards WHERE user_id = ?')
        .bind(uid)
        .all<{ id: string }>()
      const existingIds = new Set(existing.results.map(r => r.id))
      const desiredIds = new Set(ownBoards.map(b => b.id))

      const stmts: Array<{ run(): Promise<unknown> }> = []
      for (const b of ownBoards) {
        if (existingIds.has(b.id)) {
          stmts.push(
            db
              .prepare(
                'UPDATE boards SET name = ?, tags = ?, updated_at = ? WHERE user_id = ? AND id = ?'
              )
              .bind(b.name, JSON.stringify(b.tags ?? []), ts, uid, b.id)
          )
        } else {
          stmts.push(
            db
              .prepare(
                `INSERT INTO boards
                   (user_id, id, handle, name, tags, mode, version, tasks_version, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`
              )
              // Every board starts standard; automation is switched on by its
              // own activation route, never by a create.
              .bind(
                uid,
                b.id,
                newHandle(),
                b.name,
                JSON.stringify(b.tags ?? []),
                'standard',
                ts,
                ts
              )
          )
        }

        // Per-viewer pin/position (board_prefs, §7.2). Only reconcile when the
        // board carries the fields — a create or a legacy payload that omits
        // them must not clobber an existing pin. owner_id = uid: in T2 the viewer
        // only ever writes prefs for boards they own.
        if (b.pinned !== undefined || b.position !== undefined) {
          stmts.push(
            db
              .prepare(
                `INSERT INTO board_prefs (user_id, owner_id, board_id, pinned, position)
                   VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(user_id, owner_id, board_id)
                   DO UPDATE SET pinned = excluded.pinned, position = excluded.position`
              )
              .bind(uid, uid, b.id, b.pinned ? 1 : 0, b.position ?? 0)
          )
        }
      }
      for (const id of existingIds) {
        if (!desiredIds.has(id)) {
          stmts.push(
            db.prepare('DELETE FROM tasks WHERE user_id = ? AND board_id = ?').bind(uid, id)
          )
          stmts.push(...trackerDeletes(db, uid, id))
          stmts.push(db.prepare('DELETE FROM boards WHERE user_id = ? AND id = ?').bind(uid, id))
          // Drop this viewer's pref rows for the removed board (all owners: cheap
          // and correct — a grantee's pin of a since-deleted board is dead too).
          stmts.push(
            db.prepare('DELETE FROM board_prefs WHERE user_id = ? AND board_id = ?').bind(uid, id)
          )
        }
      }
      if (stmts.length) await db.batch(stmts)
    },

    // --- Tasks (board scoped) -------------------------------------------
    async getTasks(_userType: UserType, sessionId?: string, boardId?: string): Promise<TasksFile> {
      if (!boardId) boardId = DEFAULT_BOARD_ID
      const cached = takePrefetched(prefetchedTasks, boardId)
      if (cached) return cached
      const uid = sessionId ?? 'public'
      // The scaffolding check rides in the same batch as the read. A first read
      // DOES scaffold a new user (their default board must exist for whatever
      // they do next), so a miss scaffolds and reads again — new users only.
      const bid = boardId
      const read = () =>
        readBatch([
          db.prepare('SELECT 1 AS ok FROM board_meta WHERE user_id = ?').bind(uid),
          db
            .prepare('SELECT tasks_version FROM boards WHERE user_id = ? AND id = ?')
            .bind(uid, bid),
          db
            .prepare(
              `SELECT ${TASK_COLUMNS}
                 FROM tasks WHERE user_id = ? AND board_id = ? AND ${VISIBLE_PREDICATE}
                 ORDER BY created_at, id`
            )
            .bind(uid, bid, completedCutoff())
        ])
      let rows = initializedFor === uid ? null : await read()
      if (rows && rows[0].length === 0) {
        await ensureInitialized(sessionId)
        rows = null
      }
      initializedFor = uid
      const [, versionRows, taskRows] = (rows ?? (await read())) as [
        unknown[],
        Array<{ tasks_version: number }>,
        TaskRow[]
      ]
      return {
        version: versionRows[0]?.tasks_version ?? 1,
        updatedAt: nowIso(),
        tasks: taskRows.map(rowToTask)
      }
    },

    async saveTasks(
      _userType: UserType,
      sessionId: string | undefined,
      boardId: string | undefined,
      tasks: TasksFile
    ): Promise<void> {
      dropPrefetched()
      await ensureInitialized(sessionId)
      if (!boardId) boardId = DEFAULT_BOARD_ID
      const uid = sessionId ?? 'public'
      const ts = nowIso()

      // Reconcile the board's VISIBLE rows to match the file. The file is the
      // full visible set, never the full table — so the existing-id scan uses the
      // SAME predicate getTasks read with. Without that, every closed task (and
      // every Deleted row) would be hard-deleted by the next write, silently
      // destroying the history this whole design exists to keep.
      //
      // No race: completedCutoff() is monotonic, so this cutoff is always >= the
      // one the read used. The write's window is a subset of the read's, meaning
      // a task can never be absent from the file yet still look deletable.
      const existing = await db
        .prepare(`SELECT id FROM tasks WHERE user_id = ? AND board_id = ? AND ${VISIBLE_PREDICATE}`)
        .bind(uid, boardId, completedCutoff())
        .all<{ id: string }>()
      const existingIds = new Set(existing.results.map(r => r.id))
      const desiredIds = new Set(tasks.tasks.map(t => t.id))

      const stmts: Array<{ run(): Promise<unknown> }> = []
      for (const task of tasks.tasks) {
        stmts.push(upsertTaskStmt(db, uid, boardId, task))
      }
      for (const id of existingIds) {
        if (!desiredIds.has(id)) {
          stmts.push(db.prepare('DELETE FROM tasks WHERE user_id = ? AND id = ?').bind(uid, id))
        }
      }
      // tasks_version is the board's task-collection OCC counter (mirrors the
      // KV TasksFile.version). Last-write-wins here — the opt-in App-level
      // check in withTaskOperation already rejects a stale If-Match at read.
      stmts.push(
        db
          .prepare(
            'UPDATE boards SET tasks_version = ?, updated_at = ? WHERE user_id = ? AND id = ?'
          )
          .bind(tasks.version ?? 1, ts, uid, boardId)
      )
      await batchTaskWrite(db, uid, stmts, tasks.tasks)
    },

    // --- Batch task write across boards (atomic) ------------------------
    async batchSaveTasks(
      _userType: UserType,
      sessionId: string | undefined,
      writes: Array<{ boardId: string; tasks: TasksFile }>
    ): Promise<void> {
      dropPrefetched()
      await ensureInitialized(sessionId)
      const uid = sessionId ?? 'public'
      const ts = nowIso()

      // Split into deletes and upserts, and run ALL deletes before ANY upsert.
      // The tasks PK is (user_id, id) — global per user, not per board — so a
      // cross-board move is a DELETE on the source board plus an UPSERT (with the
      // new board_id) on the target. If the upsert ran first, the source's delete
      // would then wipe the just-moved row. Deletes-first makes it correct
      // regardless of the order boards appear in `writes`.
      const deletes: Array<{ run(): Promise<unknown> }> = []
      const upserts: Array<{ run(): Promise<unknown> }> = []

      for (const w of writes) {
        const boardId = w.boardId || DEFAULT_BOARD_ID
        // Same visible-window scan as saveTasks — a closed or deleted row must
        // never become a deletion candidate just because it aged out of view.
        const existing = await db
          .prepare(
            `SELECT id FROM tasks WHERE user_id = ? AND board_id = ? AND ${VISIBLE_PREDICATE}`
          )
          .bind(uid, boardId, completedCutoff())
          .all<{ id: string }>()
        const existingIds = new Set(existing.results.map(r => r.id))
        const desiredIds = new Set(w.tasks.tasks.map(t => t.id))

        for (const task of w.tasks.tasks) {
          upserts.push(upsertTaskStmt(db, uid, boardId, task))
        }
        for (const id of existingIds) {
          if (!desiredIds.has(id)) {
            deletes.push(db.prepare('DELETE FROM tasks WHERE user_id = ? AND id = ?').bind(uid, id))
          }
        }
        upserts.push(
          db
            .prepare(
              'UPDATE boards SET tasks_version = ?, updated_at = ? WHERE user_id = ? AND id = ?'
            )
            .bind(w.tasks.version ?? 1, ts, uid, boardId)
        )
      }

      await batchTaskWrite(
        db,
        uid,
        [...deletes, ...upserts],
        writes.flatMap(w => w.tasks.tasks)
      )
    },

    // --- Stats (D1 events; identical to the KV adapter's stats path) ------
    async getStats(_userType: UserType, sessionId?: string, boardId?: string): Promise<StatsFile> {
      if (!boardId) boardId = DEFAULT_BOARD_ID
      const cached = takePrefetched(prefetchedStats, boardId)
      if (cached) return cached
      const userKey = sessionId ? maskKey(sessionId) : 'public'
      const read = (key: string) =>
        Promise.all([
          getD1BoardStats(env.DB, key, boardId),
          getBoardTimeline(env.DB, key, boardId, TIMELINE_LIMIT)
        ])
      let [counters, timeline] = await read(userKey)
      const noRows = timeline.length === 0 && Object.values(counters).every(v => !v || v === 0)
      if (noRows && legacyId) {
        const legacyKey = maskKey(legacyId)
        if (legacyKey !== userKey) [counters, timeline] = await read(legacyKey)
      }
      return statsFile(
        counters,
        timeline.map(event => ({
          t: event.timestamp,
          event: event.event as 'created' | 'completed' | 'edited' | 'deleted',
          id: event.id
        }))
      )
    },

    async saveStats(
      _userType: UserType,
      sessionId: string | undefined,
      boardId: string | undefined,
      stats: StatsFile
    ): Promise<void> {
      dropPrefetched()
      if (!boardId) boardId = DEFAULT_BOARD_ID
      const userKey = sessionId ? maskKey(sessionId) : 'public'
      // The operation's events are the timeline's tail, and they all carry the
      // operation's one ISO timestamp. Stored events read back in SQLite's
      // `datetime('now')` form ("YYYY-MM-DD HH:MM:SS", no "T"), so a tail of
      // those means the operation added nothing. Log every new one — a batch
      // create is N 'created' events, not one.
      const timeline = stats.timeline ?? []
      const latest = timeline[timeline.length - 1]
      if (!latest || !latest.t.includes('T')) return
      let first = timeline.length - 1
      while (first > 0 && timeline[first - 1].t === latest.t) first--
      await logTaskEvents(
        env.DB,
        timeline.slice(first).map(e => ({
          userKey,
          boardId: boardId as string,
          taskId: e.id || '',
          eventType: e.event
        }))
      )
    },

    // --- Delete board data ----------------------------------------------
    async deleteBoardData(_userType: UserType, sessionId: string, boardId: string): Promise<void> {
      dropPrefetched()
      await ensureInitialized(sessionId)
      // `sessionId` is a required string, so the `?? 'public'` that used to sit
      // here could never fire — a dead guard, and a misleading one: it sat on
      // `tasks.user_id` / `boards.user_id`, which ARE ownership columns, and so
      // suggested `'public'` is a value that may own a row. It is not
      // (IDENTITY_MODEL.md R8: absence is NULL, never an in-band sentinel).
      // Removed rather than made reachable.
      await db.batch([
        db.prepare('DELETE FROM tasks WHERE user_id = ? AND board_id = ?').bind(sessionId, boardId),
        ...trackerDeletes(db, sessionId, boardId),
        db.prepare('DELETE FROM boards WHERE user_id = ? AND id = ?').bind(sessionId, boardId)
      ])
      // Events live in D1 keyed by the masked credential (unchanged path).
      await deleteBoardEvents(env.DB, maskKey(sessionId), boardId)
      if (legacyId && legacyId !== sessionId) {
        await deleteBoardEvents(env.DB, maskKey(legacyId), boardId)
      }
    }
  }
}

/** SQLite's message when the `tasks_source` unique index refuses a write. */
const SOURCE_CLASH = /UNIQUE constraint failed: tasks\.user_id, tasks\.source, tasks\.source_id/

/**
 * Run a task write as ONE atomic batch, turning a `tasks_source` clash into a
 * DuplicateSourceError (409) that names the pair, instead of a bare 500.
 *
 * The handlers already refuse a clash they can see — within the write, or on
 * the same board. What reaches here is a live task on ANOTHER board of the same
 * user holding the pair, so the batch rolled back whole and nothing landed.
 * Only on that failure do we look up which pair it was.
 */
async function batchTaskWrite(
  db: D1Like,
  uid: string,
  stmts: Array<{ run(): Promise<unknown> }>,
  written: Task[]
): Promise<void> {
  try {
    await db.batch(stmts)
  } catch (err) {
    const e = err as { message?: unknown; cause?: { message?: unknown } }
    const text = `${String(e?.message ?? '')} ${String(e?.cause?.message ?? '')}`
    if (!SOURCE_CLASH.test(text)) throw err
    const live = await db
      .prepare(
        `SELECT id, source, source_id FROM tasks
          WHERE user_id = ? AND state = 'Active' AND source IS NOT NULL AND source_id IS NOT NULL`
      )
      .bind(uid)
      .all<{ id: string; source: string; source_id: string }>()
    for (const t of written) {
      if (t.state !== 'Active' || t.source == null || t.sourceId == null) continue
      const holder = live.results.find(
        r => r.source === t.source && r.source_id === t.sourceId && r.id !== t.id
      )
      if (holder) throw new DuplicateSourceError(t.source, t.sourceId, holder.id)
    }
    throw err
  }
}

/** Upsert a single task row (INSERT … ON CONFLICT(user_id,id) DO UPDATE). */
function upsertTaskStmt(db: D1Like, uid: string, boardId: string, task: Task) {
  return db
    .prepare(
      `INSERT INTO tasks
         (user_id, board_id, id, title, notes, tag, state, date, start_time, end_time,
          source, source_id, metadata, status, created_at, updated_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET
         board_id = excluded.board_id,
         title = excluded.title,
         notes = excluded.notes,
         tag = excluded.tag,
         state = excluded.state,
         date = excluded.date,
         start_time = excluded.start_time,
         end_time = excluded.end_time,
         source = excluded.source,
         source_id = excluded.source_id,
         metadata = excluded.metadata,
         status = excluded.status,
         updated_at = excluded.updated_at,
         closed_at = excluded.closed_at`
    )
    .bind(
      uid,
      boardId,
      task.id,
      task.title,
      task.notes ?? null,
      task.tag ?? null,
      task.state ?? 'Active',
      task.date ?? null,
      task.startTime ?? null,
      task.endTime ?? null,
      task.source ?? null,
      task.sourceId ?? null,
      task.metadata ? JSON.stringify(task.metadata) : null,
      task.status ? JSON.stringify(task.status) : null,
      task.createdAt ?? nowIso(),
      task.updatedAt ?? null,
      task.closedAt ?? null
    )
}

/** What a shared board needs from its owner's scope to render. */
export interface SharedBoardContents {
  tasks: Task[]
  stats: StatsFile
  claimed: Set<string>
}

/**
 * Tasks, stats and live claims of the boards SHARED with a viewer, read from
 * each OWNER's scope in ONE round trip for all of them.
 *
 * The boards come from the viewer's own GET /boards in the same request — the
 * board_shares join already established the access — so each is addressed by
 * (ownerUserId, handle) directly instead of being re-resolved one by one, which
 * was three serial round trips per board.
 */
export async function readSharedBoards(
  env: Env,
  boards: Array<{ handle: string; ownerUserId: string }>
): Promise<Map<string, SharedBoardContents>> {
  const out = new Map<string, SharedBoardContents>()
  if (boards.length === 0) return out
  const db = env.DB as unknown as D1Like
  const now = nowIso()
  const cutoff = completedCutoff()
  const BOARD = '(SELECT id FROM boards WHERE user_id = ? AND handle = ?)'
  const stmts = boards.flatMap(({ handle, ownerUserId: owner }) => [
    db
      .prepare(
        `SELECT ${TASK_COLUMNS}
           FROM tasks WHERE user_id = ? AND board_id = ${BOARD} AND ${VISIBLE_PREDICATE}
           ORDER BY created_at, id`
      )
      .bind(owner, owner, handle, cutoff),
    db
      .prepare(
        `SELECT event_type, COUNT(*) AS count FROM task_events
          WHERE user_key = ? AND board_id = ${BOARD} GROUP BY event_type`
      )
      .bind(maskKey(owner), owner, handle),
    db
      .prepare(
        `SELECT task_id, event_type, timestamp FROM task_events
          WHERE user_key = ? AND board_id = ${BOARD}
          ORDER BY timestamp DESC LIMIT ?`
      )
      .bind(maskKey(owner), owner, handle, TIMELINE_LIMIT),
    db
      .prepare(
        `SELECT task_id FROM task_claims
          WHERE user_id = ? AND board_id = ${BOARD} AND expires_at > ?`
      )
      .bind(owner, owner, handle, now)
  ])
  const res = (await db.batch(stmts)) as Array<{ results?: unknown[] }>
  boards.forEach(({ handle }, i) => {
    const [tasks, counts, timeline, claims] = res.slice(4 * i, 4 * i + 4).map(r => r.results ?? [])
    out.set(handle, {
      tasks: (tasks as TaskRow[]).map(rowToTask),
      stats: statsFile(
        tallyEvents(counts as Array<{ event_type: string; count: number }>),
        toTimeline(timeline as EventRow[])
      ),
      claimed: new Set((claims as Array<{ task_id: string }>).map(r => r.task_id))
    })
  })
  return out
}
