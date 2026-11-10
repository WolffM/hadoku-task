/**
 * Tracker boards.
 *
 * A tracker board is a `boards` row with mode = 'tracker'. It holds trackers —
 * named counters (pushups, glasses of water) or values (weight) — instead of
 * tasks, and every change to one is an entry in `tracker_entries`, which is the
 * board's history and the source of its per-day totals.
 *
 * Wife tier and up only, on every route: the caller's tier is checked, not the
 * owner's. Board access resolves exactly as tasks do (route-utils), so a tracker
 * board can be shared and a read-only grantee can look but not log.
 *
 * Unlike tasks there is no localStorage mirror: these routes ARE the store, and
 * the client reads them back after every write. That is what lets a later
 * physical button (source = 'button') show up on the board.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { TaskUtils } from '@wolffm/task/api'
import { tierAtLeast } from '@wolffm/worker-utils'
import { getBoardContext, type BoardCtx } from './route-utils'
import {
  ForbiddenErrorSchema,
  TrackerConflictErrorSchema,
  TrackerNotFoundErrorSchema,
  boardRefParam
} from '../schemas-errors'
import {
  CreateTrackerEntryInputSchema,
  CreateTrackerInputSchema,
  DeleteTrackerEntryResponseSchema,
  DeleteTrackerResponseSchema,
  ListTrackersQuerySchema,
  ListTrackersResponseSchema,
  TrackerEntryResponseSchema,
  TrackerResponseSchema,
  UpdateTrackerInputSchema
} from '../schemas-trackers'
import type { AppContext } from '../types'

export const TRACKER_MODE = 'tracker'
/** Default history window: 8 days covers a "last 7 days" total in any timezone. */
const DEFAULT_WINDOW_MS = 8 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 500
const TIER_ERROR = 'Tracker boards need wife tier or above'

const json = <S extends z.ZodTypeAny>(schema: S) => ({ 'application/json': { schema } })
const forbidden = {
  description: 'Below wife tier, or read-only on this board (FORBIDDEN)',
  content: json(ForbiddenErrorSchema)
}
const notFound = {
  description: 'Board, tracker or entry not found',
  content: json(TrackerNotFoundErrorSchema)
}
const conflict = {
  description: 'Not a tracker board (BOARD_NOT_TRACKER)',
  content: json(TrackerConflictErrorSchema)
}

const trackerParams = boardRefParam.extend({
  trackerId: z.string().openapi({ param: { name: 'trackerId', in: 'path' } })
})
const entryParams = trackerParams.extend({
  entryId: z.string().openapi({ param: { name: 'entryId', in: 'path' } })
})

interface TrackerRow {
  id: string
  name: string
  kind: string
  unit: string | null
  value: number
  position: number
  created_at: string
  updated_at: string
}
interface EntryRow {
  id: string
  tracker_id: string
  delta: number | null
  value: number
  source: string
  actor_id: string | null
  note: string | null
  at: string
}

const toTracker = (r: TrackerRow) => ({
  id: r.id,
  name: r.name,
  kind: r.kind === 'value' ? ('value' as const) : ('counter' as const),
  unit: r.unit,
  value: r.value,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})
const toEntry = (r: EntryRow) => ({
  id: r.id,
  trackerId: r.tracker_id,
  delta: r.delta,
  value: r.value,
  source: (['api', 'button'].includes(r.source) ? r.source : 'web') as 'web' | 'api' | 'button',
  actorId: r.actor_id,
  note: r.note,
  at: r.at
})

const TRACKER_COLS = 'id, name, kind, unit, value, position, created_at, updated_at'
const ENTRY_COLS = 'id, tracker_id, delta, value, source, actor_id, note, at'

type Fail =
  | { status: 403; body: { error: string; code: 'FORBIDDEN' } }
  | {
      status: 404
      body: { error: string; code: 'BOARD_NOT_FOUND' | 'TRACKER_NOT_FOUND' | 'ENTRY_NOT_FOUND' }
    }
  | { status: 409; body: { error: string; code: 'BOARD_NOT_TRACKER' } }

const fail = {
  tier: (): Fail => ({ status: 403, body: { error: TIER_ERROR, code: 'FORBIDDEN' } }),
  readonly: (): Fail => ({
    status: 403,
    body: { error: 'Read-only access to this board', code: 'FORBIDDEN' }
  }),
  board: (ref: string): Fail => ({
    status: 404,
    body: { error: `Board ${ref} not found`, code: 'BOARD_NOT_FOUND' }
  }),
  notTracker: (ref: string): Fail => ({
    status: 409,
    body: { error: `Board ${ref} is not a tracker board`, code: 'BOARD_NOT_TRACKER' }
  }),
  tracker: (id: string): Fail => ({
    status: 404,
    body: { error: `Tracker ${id} not found`, code: 'TRACKER_NOT_FOUND' }
  }),
  entry: (id: string): Fail => ({
    status: 404,
    body: { error: `Entry ${id} not found`, code: 'ENTRY_NOT_FOUND' }
  })
}

/** Answer a failure with its literal status, so each branch types against the route. */
function reply(c: Context<AppContext>, f: Fail) {
  switch (f.status) {
    case 403:
      return c.json(f.body, 403)
    case 404:
      return c.json(f.body, 404)
    case 409:
      return c.json(f.body, 409)
  }
}

/**
 * Resolve a tracker board for the caller: tier, existence, mode and (for a
 * write) access. Returns the board context or the failure to answer with.
 */
async function trackerBoard(
  c: Context<AppContext>,
  ref: string,
  write: boolean
): Promise<{ ctx: BoardCtx } | { fail: Fail }> {
  if (!tierAtLeast(c.get('authContext'), 'wife')) return { fail: fail.tier() }
  const ctx = await getBoardContext(c, ref)
  if (!ctx || !ctx.exists) return { fail: fail.board(ref) }
  if (ctx.mode !== TRACKER_MODE) return { fail: fail.notTracker(ref) }
  if (write && ctx.access === 'readonly') return { fail: fail.readonly() }
  return { ctx }
}

async function readTracker(db: D1Database, ownerId: string, boardId: string, id: string) {
  return db
    .prepare(`SELECT ${TRACKER_COLS} FROM trackers WHERE user_id = ? AND board_id = ? AND id = ?`)
    .bind(ownerId, boardId, id)
    .first<TrackerRow>()
}

export function createTrackerRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // ---------------------------------------------------------------- list
  app.openapi(
    createRoute({
      method: 'get',
      path: '/boards/{ref}/trackers',
      tags: ['Trackers'],
      summary: "A tracker board's trackers and recent entries",
      request: { params: boardRefParam, query: ListTrackersQuerySchema },
      responses: {
        200: { description: 'Trackers and entries', content: json(ListTrackersResponseSchema) },
        403: forbidden,
        404: notFound,
        409: conflict
      }
    }),
    async c => {
      const { ref } = c.req.valid('param')
      const { since } = c.req.valid('query')
      const r = await trackerBoard(c, ref, false)
      if ('fail' in r) return reply(c, r.fail)
      const { ownerId, boardId, access } = r.ctx
      const from = since ?? new Date(Date.now() - DEFAULT_WINDOW_MS).toISOString()
      const [trackers, entries] = await c.env.DB.batch([
        c.env.DB.prepare(
          `SELECT ${TRACKER_COLS} FROM trackers WHERE user_id = ? AND board_id = ?
            ORDER BY position, created_at`
        ).bind(ownerId, boardId),
        c.env.DB.prepare(
          // rowid, not id, breaks a same-millisecond tie: an id's tail is
          // random (generateULID), so two entries written in one millisecond
          // sorted by chance. rowid is insertion order.
          `SELECT ${ENTRY_COLS} FROM tracker_entries WHERE user_id = ? AND board_id = ? AND at >= ?
            ORDER BY at DESC, rowid DESC LIMIT ${MAX_ENTRIES}`
        ).bind(ownerId, boardId, from)
      ])
      return c.json(
        {
          board: ref,
          canWrite: access !== 'readonly',
          trackers: (trackers.results as unknown as TrackerRow[]).map(toTracker),
          entries: (entries.results as unknown as EntryRow[]).map(toEntry)
        },
        200
      )
    }
  )

  // ---------------------------------------------------------------- create tracker
  app.openapi(
    createRoute({
      method: 'post',
      path: '/boards/{ref}/trackers',
      tags: ['Trackers'],
      summary: 'Add a tracker to a tracker board',
      request: { params: boardRefParam, body: { content: json(CreateTrackerInputSchema) } },
      responses: {
        200: { description: 'Tracker created', content: json(TrackerResponseSchema) },
        403: forbidden,
        404: notFound,
        409: conflict
      }
    }),
    async c => {
      const { ref } = c.req.valid('param')
      const { name, kind, unit } = c.req.valid('json')
      const r = await trackerBoard(c, ref, true)
      if ('fail' in r) return reply(c, r.fail)
      const { ownerId, boardId } = r.ctx
      const id = TaskUtils.generateULID()
      const ts = new Date().toISOString()
      await c.env.DB.prepare(
        `INSERT INTO trackers (user_id, board_id, id, name, kind, unit, value, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0,
                 (SELECT COALESCE(MAX(position) + 1, 0) FROM trackers WHERE user_id = ? AND board_id = ?),
                 ?, ?)`
      )
        .bind(ownerId, boardId, id, name, kind, unit || null, ownerId, boardId, ts, ts)
        .run()
      const row = await readTracker(c.env.DB, ownerId, boardId, id)
      if (!row) throw new Error(`tracker ${id} vanished after insert`)
      return c.json({ ok: true as const, tracker: toTracker(row) }, 200)
    }
  )

  // ---------------------------------------------------------------- update tracker
  app.openapi(
    createRoute({
      method: 'patch',
      path: '/boards/{ref}/trackers/{trackerId}',
      tags: ['Trackers'],
      summary: 'Rename, re-unit or reorder a tracker',
      description: 'Its value changes only through entries, so the history always explains it.',
      request: { params: trackerParams, body: { content: json(UpdateTrackerInputSchema) } },
      responses: {
        200: { description: 'Tracker updated', content: json(TrackerResponseSchema) },
        403: forbidden,
        404: notFound,
        409: conflict
      }
    }),
    async c => {
      const { ref, trackerId } = c.req.valid('param')
      const patch = c.req.valid('json')
      const r = await trackerBoard(c, ref, true)
      if ('fail' in r) return reply(c, r.fail)
      const { ownerId, boardId } = r.ctx
      const row = await readTracker(c.env.DB, ownerId, boardId, trackerId)
      if (!row) return reply(c, fail.tracker(trackerId))
      await c.env.DB.prepare(
        'UPDATE trackers SET name = ?, unit = ?, position = ?, updated_at = ? WHERE user_id = ? AND id = ?'
      )
        .bind(
          patch.name ?? row.name,
          patch.unit === undefined ? row.unit : patch.unit || null,
          patch.position ?? row.position,
          new Date().toISOString(),
          ownerId,
          trackerId
        )
        .run()
      const updated = await readTracker(c.env.DB, ownerId, boardId, trackerId)
      if (!updated) return reply(c, fail.tracker(trackerId))
      return c.json({ ok: true as const, tracker: toTracker(updated) }, 200)
    }
  )

  // ---------------------------------------------------------------- delete tracker
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/boards/{ref}/trackers/{trackerId}',
      tags: ['Trackers'],
      summary: 'Delete a tracker and its whole history',
      request: { params: trackerParams },
      responses: {
        200: { description: 'Tracker deleted', content: json(DeleteTrackerResponseSchema) },
        403: forbidden,
        404: notFound,
        409: conflict
      }
    }),
    async c => {
      const { ref, trackerId } = c.req.valid('param')
      const r = await trackerBoard(c, ref, true)
      if ('fail' in r) return reply(c, r.fail)
      const { ownerId, boardId } = r.ctx
      const db = c.env.DB
      const [, removed] = await db.batch([
        db
          .prepare(
            'DELETE FROM tracker_entries WHERE user_id = ? AND board_id = ? AND tracker_id = ?'
          )
          .bind(ownerId, boardId, trackerId),
        db
          .prepare('DELETE FROM trackers WHERE user_id = ? AND board_id = ? AND id = ?')
          .bind(ownerId, boardId, trackerId)
      ])
      if (!removed.meta.changes) return reply(c, fail.tracker(trackerId))
      return c.json({ ok: true as const, deleted: trackerId }, 200)
    }
  )

  // ---------------------------------------------------------------- log an entry
  app.openapi(
    createRoute({
      method: 'post',
      path: '/boards/{ref}/trackers/{trackerId}/entries',
      tags: ['Trackers'],
      summary: 'Log an entry: count up/down, or set the value',
      description:
        'On a `counter`, send `delta` (default 1) to add to the count, or `value` to reset it — the entry records the difference. On a `value` tracker, send `value`. The update and its history row commit together.',
      request: { params: trackerParams, body: { content: json(CreateTrackerEntryInputSchema) } },
      responses: {
        200: { description: 'Entry logged', content: json(TrackerEntryResponseSchema) },
        400: {
          description: 'A `value` tracker needs `value`',
          content: json(z.object({ error: z.string() }))
        },
        403: forbidden,
        404: notFound,
        409: conflict
      }
    }),
    async c => {
      const { ref, trackerId } = c.req.valid('param')
      const body = c.req.valid('json')
      const r = await trackerBoard(c, ref, true)
      if ('fail' in r) return reply(c, r.fail)
      const { ownerId, boardId, callerId } = r.ctx
      const db = c.env.DB
      const row = await readTracker(db, ownerId, boardId, trackerId)
      if (!row) return reply(c, fail.tracker(trackerId))
      if (row.kind === 'value' && body.value === undefined) {
        return c.json({ error: 'A value tracker takes `value`, not `delta`' }, 400)
      }

      const id = TaskUtils.generateULID()
      const at = new Date().toISOString()
      // The history row reads the tracker inside the same transaction, so a
      // concurrent hit can never leave an entry whose `value` disagrees with it.
      const insertFrom = (deltaSql: string, valueSql: string, extra: unknown[]) =>
        db
          .prepare(
            `INSERT INTO tracker_entries
               (user_id, board_id, tracker_id, id, delta, value, source, actor_id, note, at)
             SELECT user_id, board_id, id, ?, ${deltaSql}, ${valueSql}, ?, ?, ?, ?
               FROM trackers WHERE user_id = ? AND id = ?`
          )
          .bind(id, ...extra, body.source, callerId, body.note || null, at, ownerId, trackerId)
      const update = (setSql: string, arg: number) =>
        db
          .prepare(
            `UPDATE trackers SET value = ${setSql}, updated_at = ? WHERE user_id = ? AND id = ?`
          )
          .bind(arg, at, ownerId, trackerId)

      if (body.value === undefined) {
        const delta = body.delta ?? 1
        await db.batch([update('value + ?', delta), insertFrom('?', 'value', [delta])])
      } else if (row.kind === 'value') {
        await db.batch([insertFrom('NULL', '?', [body.value]), update('?', body.value)])
      } else {
        // Counter reset: record the difference from what it was, then set it.
        await db.batch([
          insertFrom('? - value', '?', [body.value, body.value]),
          update('?', body.value)
        ])
      }

      const [tracker, entry] = await Promise.all([
        readTracker(db, ownerId, boardId, trackerId),
        db
          .prepare(`SELECT ${ENTRY_COLS} FROM tracker_entries WHERE user_id = ? AND id = ?`)
          .bind(ownerId, id)
          .first<EntryRow>()
      ])
      if (!tracker || !entry) return reply(c, fail.tracker(trackerId))
      return c.json({ ok: true as const, tracker: toTracker(tracker), entry: toEntry(entry) }, 200)
    }
  )

  // ---------------------------------------------------------------- undo an entry
  app.openapi(
    createRoute({
      method: 'delete',
      path: '/boards/{ref}/trackers/{trackerId}/entries/{entryId}',
      tags: ['Trackers'],
      summary: 'Delete an entry, undoing it',
      description:
        "On a counter the entry's delta is taken back off the count. On a value tracker the value falls back to the newest remaining entry (0 if none).",
      request: { params: entryParams },
      responses: {
        200: { description: 'Entry deleted', content: json(DeleteTrackerEntryResponseSchema) },
        403: forbidden,
        404: notFound,
        409: conflict
      }
    }),
    async c => {
      const { ref, trackerId, entryId } = c.req.valid('param')
      const r = await trackerBoard(c, ref, true)
      if ('fail' in r) return reply(c, r.fail)
      const { ownerId, boardId } = r.ctx
      const db = c.env.DB
      const row = await readTracker(db, ownerId, boardId, trackerId)
      if (!row) return reply(c, fail.tracker(trackerId))
      const entry = await db
        .prepare(
          `SELECT ${ENTRY_COLS} FROM tracker_entries WHERE user_id = ? AND tracker_id = ? AND id = ?`
        )
        .bind(ownerId, trackerId, entryId)
        .first<EntryRow>()
      if (!entry) return reply(c, fail.entry(entryId))

      const at = new Date().toISOString()
      const del = db
        .prepare('DELETE FROM tracker_entries WHERE user_id = ? AND id = ?')
        .bind(ownerId, entryId)
      if (row.kind === 'value') {
        await db.batch([
          del,
          db
            .prepare(
              `UPDATE trackers SET updated_at = ?, value = COALESCE(
                 (SELECT value FROM tracker_entries WHERE user_id = ? AND tracker_id = ?
                   ORDER BY at DESC, rowid DESC LIMIT 1), 0)
               WHERE user_id = ? AND id = ?`
            )
            .bind(at, ownerId, trackerId, ownerId, trackerId)
        ])
      } else {
        await db.batch([
          db
            .prepare(
              'UPDATE trackers SET value = value - ?, updated_at = ? WHERE user_id = ? AND id = ?'
            )
            .bind(entry.delta ?? 0, at, ownerId, trackerId),
          del
        ])
      }
      const tracker = await readTracker(db, ownerId, boardId, trackerId)
      if (!tracker) return reply(c, fail.tracker(trackerId))
      return c.json({ ok: true as const, tracker: toTracker(tracker) }, 200)
    }
  )

  return app
}
