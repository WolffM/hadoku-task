/**
 * D1-backed storage adapter for @wolffm/task.
 *
 * Implements the SAME whole-file `TaskStorage` interface as createKVStorage, so
 * handlers, routes and MCP are unchanged — the swap is invisible above this
 * seam (agent-boards-design.md §3.5). What D1 buys over the KV blob:
 *   - real per-board board-metadata OCC (a conditional UPDATE, not a read-check),
 *   - a foundation for scoped hydration + a change feed (later tranches),
 *   - atomic multi-row writes via db.batch().
 *
 * Cutover is lazy read-repair (§3.5), gated by ONE signal per user: the
 * board_meta row. Absent ⇒ this user's data still lives in KV ⇒ migrate the
 * whole dataset (boards + every board's tasks) into D1 in one idempotent batch,
 * then delete the KV entries. Present ⇒ D1 is authoritative and KV is never
 * touched again. Every migration INSERT is `OR IGNORE`, so two worker instances
 * racing the first read both converge on the same rows with no duplicates and no
 * lost updates — the loser's inserts are no-ops.
 *
 * `legacyId` is the pre-userId-flip raw-credential namespace (same meaning as in
 * createKVStorage): when the userId KV namespace has nothing, fall back to the
 * raw-key namespace so a user who never flipped still migrates on first read.
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
import { boardsKey, tasksKey } from '../kv-keys'
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
}

function rowToTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
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
    tasks: [] // metadata only; the handler fans out getTasks per board (§5.5)
  }
}

const nowIso = () => new Date().toISOString()
const newHandle = () => TaskUtils.generateULID()

export function createD1Storage(env: Env, legacyId?: string): TaskStorage {
  const db = env.DB as unknown as D1Like

  // --- KV read helpers (legacy source during cutover) --------------------
  async function readKvBlob<T>(sessionId: string | undefined, boardId?: string): Promise<T | null> {
    const primary = boardId ? tasksKey(sessionId, boardId) : boardsKey(sessionId)
    const hit = await env.TASKS_KV.get<T>(primary, 'json')
    if (hit) return hit
    if (!legacyId || legacyId === sessionId) return null
    const legacyKey = boardId ? tasksKey(legacyId, boardId) : boardsKey(legacyId)
    return env.TASKS_KV.get<T>(legacyKey, 'json')
  }

  async function deleteKvBlob(sessionId: string | undefined, boardId?: string): Promise<void> {
    const keys = boardId
      ? [tasksKey(sessionId, boardId), legacyId ? tasksKey(legacyId, boardId) : null]
      : [boardsKey(sessionId), legacyId ? boardsKey(legacyId) : null]
    await Promise.all(keys.filter(Boolean).map(k => env.TASKS_KV.delete(k as string)))
  }

  // --- Migration gate: has this user been migrated to D1 yet? ------------
  async function isMigrated(sessionId: string | undefined): Promise<boolean> {
    const row = await db
      .prepare('SELECT 1 AS ok FROM board_meta WHERE user_id = ?')
      .bind(sessionId ?? 'public')
      .first<number>('ok')
    return row === 1
  }

  /**
   * Migrate this user's ENTIRE dataset (boards + every board's tasks) from KV
   * into D1, once, idempotently. Gated by board_meta; safe to call on every
   * request (fast no-op after the first migration). All INSERTs are OR IGNORE
   * so concurrent callers converge without duplicates or lost writes.
   */
  async function ensureMigrated(sessionId: string | undefined): Promise<void> {
    if (await isMigrated(sessionId)) return
    const uid = sessionId ?? 'public'

    const boardsBlob = await readKvBlob<BoardsFile>(sessionId)
    // Always include the implicit default board so a user who only ever used
    // `main` (and thus has no boards blob) still materialises it.
    const boardList: Board[] = boardsBlob?.boards?.length
      ? boardsBlob.boards
      : [{ id: DEFAULT_BOARD_ID, name: DEFAULT_BOARD_NAME, tags: [], tasks: [] }]
    const ids = new Set(boardList.map(b => b.id))
    if (!ids.has(DEFAULT_BOARD_ID)) {
      boardList.push({ id: DEFAULT_BOARD_ID, name: DEFAULT_BOARD_NAME, tags: [], tasks: [] })
    }
    const collectionVersion = boardsBlob?.version ?? 1

    const stmts: Array<{ run(): Promise<unknown> }> = []
    const ts = nowIso()
    const migratedTaskKeys: string[] = []

    for (const board of boardList) {
      const tasksBlob = await readKvBlob<TasksFile>(sessionId, board.id)
      const tasksVersion = tasksBlob?.version ?? 1
      stmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO boards
               (user_id, id, handle, name, tags, mode, version, tasks_version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'standard', 1, ?, ?, ?)`
          )
          .bind(
            uid,
            board.id,
            newHandle(),
            board.name,
            JSON.stringify(board.tags ?? []),
            tasksVersion,
            ts,
            ts
          )
      )
      for (const task of tasksBlob?.tasks ?? []) {
        stmts.push(insertTaskStmt(uid, board.id, task))
      }
      if (tasksBlob) migratedTaskKeys.push(board.id)
    }

    stmts.push(
      db
        .prepare(`INSERT OR IGNORE INTO board_meta (user_id, version, updated_at) VALUES (?, ?, ?)`)
        .bind(uid, collectionVersion, ts)
    )

    await db.batch(stmts)

    // KV cleanup AFTER the rows have landed. Idempotent: a racing migrator
    // deleting the same keys is harmless. Leaving them would let a later read
    // re-migrate, which OR IGNORE also makes harmless — so this is best-effort.
    await deleteKvBlob(sessionId)
    await Promise.all(migratedTaskKeys.map(bid => deleteKvBlob(sessionId, bid)))
  }

  function insertTaskStmt(uid: string, boardId: string, task: Task) {
    return db
      .prepare(
        `INSERT OR IGNORE INTO tasks
           (user_id, board_id, id, title, notes, tag, state, date, start_time, end_time,
            source, source_id, metadata, created_at, updated_at, closed_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        uid,
        boardId,
        task.id,
        task.title,
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

  return {
    // --- Boards ----------------------------------------------------------
    async getBoards(_userType: UserType, sessionId?: string): Promise<BoardsFile> {
      await ensureMigrated(sessionId)
      const uid = sessionId ?? 'public'
      const meta = await db
        .prepare('SELECT version, updated_at FROM board_meta WHERE user_id = ?')
        .bind(uid)
        .first<{ version: number; updated_at: string }>()
      const { results } = await db
        .prepare(
          `SELECT id, name, tags, mode, repo, version, tasks_version
             FROM boards WHERE user_id = ? ORDER BY created_at, id`
        )
        .bind(uid)
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
      await ensureMigrated(sessionId)
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
      }
      for (const id of existingIds) {
        if (!desiredIds.has(id)) {
          stmts.push(
            db.prepare('DELETE FROM tasks WHERE user_id = ? AND board_id = ?').bind(uid, id)
          )
          stmts.push(db.prepare('DELETE FROM boards WHERE user_id = ? AND id = ?').bind(uid, id))
        }
      }
      if (stmts.length) await db.batch(stmts)
    },

    // --- Tasks (board scoped) -------------------------------------------
    async getTasks(_userType: UserType, sessionId?: string, boardId?: string): Promise<TasksFile> {
      await ensureMigrated(sessionId)
      if (!boardId) boardId = DEFAULT_BOARD_ID
      const uid = sessionId ?? 'public'
      const tasksVersion = await db
        .prepare('SELECT tasks_version FROM boards WHERE user_id = ? AND id = ?')
        .bind(uid, boardId)
        .first<number>('tasks_version')
      const { results } = await db
        .prepare(
          `SELECT id, title, tag, state, date, start_time, end_time, source, source_id,
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
      await ensureMigrated(sessionId)
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
      await ensureMigrated(sessionId)
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
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, id) DO UPDATE SET
         board_id = excluded.board_id,
         title = excluded.title,
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
