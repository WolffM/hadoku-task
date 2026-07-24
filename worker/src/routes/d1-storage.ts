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
import { VersionConflictError } from '@wolffm/task/api'
import { DEFAULT_BOARD_ID, DEFAULT_BOARD_NAME } from '../constants'
import {
  getBoardStats as getD1BoardStats,
  getBoardTimeline,
  deleteBoardEvents,
  logTaskEvent
} from '../events'
import { maskKey } from '@wolffm/worker-utils'
import type { Env } from '../types'

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
  version: number
  tasks_version: number
  handle: string
  // Sharing (§7): the board's owner and THIS viewer's access level.
  owner_user_id: string
  access: 'owner' | 'contributor' | 'readonly'
  // From the board_prefs LEFT JOIN (COALESCEd, so always present on read).
  pinned: number
  position: number
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
    metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : null
  }
}

function rowToBoard(r: BoardRow): Board {
  return {
    id: r.id,
    name: r.name,
    tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
    tasks: [], // metadata only; the handler fans out getTasks per board (§5.5)
    pinned: r.pinned === 1,
    position: r.position,
    mode: r.mode,
    handle: r.handle,
    ownerUserId: r.owner_user_id,
    access: r.access
  }
}

const nowIso = () => new Date().toISOString()
const newHandle = () => TaskUtils.generateULID()

export function createD1Storage(env: Env, legacyId?: string): TaskStorage {
  const db = env.DB as unknown as D1Like

  /**
   * Ensure a user's D1 scaffolding exists before a read/write. Fast no-op once
   * board_meta is present. For a brand-new user it creates the collection-version
   * row and the default `main` board row (so getTasks has a tasks_version home and
   * getBoards shows the default board) — the same materialisation the KV→D1
   * migration used to do, minus the KV read now that the cutover is complete.
   */
  async function ensureInitialized(sessionId: string | undefined): Promise<void> {
    const uid = sessionId ?? 'public'
    const exists = await db
      .prepare('SELECT 1 AS ok FROM board_meta WHERE user_id = ?')
      .bind(uid)
      .first<number>('ok')
    if (exists === 1) return
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
  }

  return {
    // --- Boards ----------------------------------------------------------
    async getBoards(_userType: UserType, sessionId?: string): Promise<BoardsFile> {
      await ensureInitialized(sessionId)
      const uid = sessionId ?? 'public'
      const meta = await db
        .prepare('SELECT version, updated_at FROM board_meta WHERE user_id = ?')
        .bind(uid)
        .first<{ version: number; updated_at: string }>()
      // LEFT JOIN board_prefs for this viewer's pin/position state (§7.2). For
      // own boards owner_id = uid; the join stays correct when T5 adds shared
      // boards (a grantee pins under the sharer's owner_id). COALESCE so a board
      // with no pref row reads as unpinned (0,0). Pinned first, then by position,
      // then stable by creation — so the top bar order is deterministic.
      // Owned boards UNION boards shared with this viewer (§7.1). Both carry the
      // owner id + this viewer's access level, and both join board_prefs keyed by
      // the VIEWER (§7.2) so a grantee's pins are their own. Pinned-first order is
      // stable across the union.
      const { results } = await db
        .prepare(
          `SELECT b.id, b.name, b.tags, b.mode, b.repo, b.version, b.tasks_version, b.handle,
                  b.user_id AS owner_user_id, 'owner' AS access,
                  COALESCE(p.pinned, 0)   AS pinned,
                  COALESCE(p.position, 0) AS position
             FROM boards b
             LEFT JOIN board_prefs p
               ON p.user_id = ? AND p.owner_id = b.user_id AND p.board_id = b.id
            WHERE b.user_id = ?
           UNION ALL
           SELECT b.id, b.name, b.tags, b.mode, b.repo, b.version, b.tasks_version, b.handle,
                  b.user_id AS owner_user_id, s.level AS access,
                  COALESCE(p.pinned, 0)   AS pinned,
                  COALESCE(p.position, 0) AS position
             FROM board_shares s
             JOIN boards b ON b.user_id = s.owner_user_id AND b.id = s.board_id
             LEFT JOIN board_prefs p
               ON p.user_id = ? AND p.owner_id = b.user_id AND p.board_id = b.id
            WHERE s.grantee_user_id = ?
            ORDER BY pinned DESC, position ASC, owner_user_id, id`
        )
        .bind(uid, uid, uid, uid)
        .all<BoardRow>()
      const boards = results.length
        ? results.map(rowToBoard)
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
      const existing = await db
        .prepare('SELECT id FROM boards WHERE user_id = ?')
        .bind(uid)
        .all<{ id: string }>()
      const existingIds = new Set(existing.results.map(r => r.id))
      const desiredIds = new Set(boards.boards.map(b => b.id))

      const stmts: Array<{ run(): Promise<unknown> }> = []
      for (const b of boards.boards) {
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
                 VALUES (?, ?, ?, ?, ?, 'standard', 1, 1, ?, ?)`
              )
              .bind(uid, b.id, newHandle(), b.name, JSON.stringify(b.tags ?? []), ts, ts)
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
      await ensureInitialized(sessionId)
      if (!boardId) boardId = DEFAULT_BOARD_ID
      const uid = sessionId ?? 'public'
      const tasksVersion = await db
        .prepare('SELECT tasks_version FROM boards WHERE user_id = ? AND id = ?')
        .bind(uid, boardId)
        .first<number>('tasks_version')
      const { results } = await db
        .prepare(
          `SELECT id, title, notes, tag, state, date, start_time, end_time, source, source_id,
                  metadata, created_at, updated_at, closed_at
             FROM tasks WHERE user_id = ? AND board_id = ? AND state = 'Active'
             ORDER BY created_at, id`
        )
        .bind(uid, boardId)
        .all<TaskRow>()
      return {
        version: tasksVersion ?? 1,
        updatedAt: nowIso(),
        tasks: results.map(rowToTask)
      }
    },

    async saveTasks(
      _userType: UserType,
      sessionId: string | undefined,
      boardId: string | undefined,
      tasks: TasksFile
    ): Promise<void> {
      await ensureInitialized(sessionId)
      if (!boardId) boardId = DEFAULT_BOARD_ID
      const uid = sessionId ?? 'public'
      const ts = nowIso()

      // Reconcile the board's active-task rows to match the file (the whole-file
      // contract: the file is the full active set). Upsert every task; delete
      // rows no longer present. Bump the board's tasks_version to the file's.
      const existing = await db
        .prepare(`SELECT id FROM tasks WHERE user_id = ? AND board_id = ?`)
        .bind(uid, boardId)
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
      await db.batch(stmts)
    },

    // --- Batch task write across boards (atomic) ------------------------
    async batchSaveTasks(
      _userType: UserType,
      sessionId: string | undefined,
      writes: Array<{ boardId: string; tasks: TasksFile }>
    ): Promise<void> {
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
        const existing = await db
          .prepare('SELECT id FROM tasks WHERE user_id = ? AND board_id = ?')
          .bind(uid, boardId)
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

      await db.batch([...deletes, ...upserts])
    },

    // --- Stats (D1 events; identical to the KV adapter's stats path) ------
    async getStats(_userType: UserType, sessionId?: string, boardId?: string): Promise<StatsFile> {
      if (!boardId) boardId = DEFAULT_BOARD_ID
      const userKey = sessionId ? maskKey(sessionId) : 'public'
      let counters = await getD1BoardStats(env.DB, userKey, boardId)
      let timeline = await getBoardTimeline(env.DB, userKey, boardId, 100)
      const noRows = timeline.length === 0 && Object.values(counters).every(v => !v || v === 0)
      if (noRows && legacyId) {
        const legacyKey = maskKey(legacyId)
        if (legacyKey !== userKey) {
          counters = await getD1BoardStats(env.DB, legacyKey, boardId)
          timeline = await getBoardTimeline(env.DB, legacyKey, boardId, 100)
        }
      }
      return {
        version: 2,
        counters,
        timeline: timeline.map(event => ({
          t: event.timestamp,
          event: event.event as 'created' | 'completed' | 'edited' | 'deleted',
          id: event.id
        })),
        tasks: {},
        updatedAt: nowIso()
      }
    },

    async saveStats(
      _userType: UserType,
      sessionId: string | undefined,
      boardId: string | undefined,
      stats: StatsFile
    ): Promise<void> {
      if (!boardId) boardId = DEFAULT_BOARD_ID
      const userKey = sessionId ? maskKey(sessionId) : 'public'
      if (stats.timeline && stats.timeline.length > 0) {
        const latestEvent = stats.timeline[stats.timeline.length - 1]
        await logTaskEvent(env.DB, {
          userKey,
          boardId,
          taskId: latestEvent.id || '',
          eventType: latestEvent.event,
          metadata: undefined
        })
      }
    },

    // --- Delete board data ----------------------------------------------
    async deleteBoardData(_userType: UserType, sessionId: string, boardId: string): Promise<void> {
      await ensureInitialized(sessionId)
      const uid = sessionId ?? 'public'
      await db.batch([
        db.prepare('DELETE FROM tasks WHERE user_id = ? AND board_id = ?').bind(uid, boardId),
        db.prepare('DELETE FROM boards WHERE user_id = ? AND id = ?').bind(uid, boardId)
      ])
      // Events live in D1 keyed by the masked credential (unchanged path).
      await deleteBoardEvents(env.DB, maskKey(sessionId), boardId)
      if (legacyId && legacyId !== sessionId) {
        await deleteBoardEvents(env.DB, maskKey(legacyId), boardId)
      }
    }
  }
}

/** Upsert a single task row (INSERT … ON CONFLICT(user_id,id) DO UPDATE). */
function upsertTaskStmt(db: D1Like, uid: string, boardId: string, task: Task) {
  return db
    .prepare(
      `INSERT INTO tasks
         (user_id, board_id, id, title, notes, tag, state, date, start_time, end_time,
          source, source_id, metadata, created_at, updated_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      task.createdAt ?? nowIso(),
      task.updatedAt ?? null,
      task.closedAt ?? null
    )
}
