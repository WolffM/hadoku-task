/**
 * Sequence widgets: a library sequence placed on a board, beside its tasks and
 * trackers. The widget PINS a sequence version, so the sequence's author
 * editing or deleting it never changes what plays here. `latestVersion` on the
 * resolved sequence says when there is a newer one, and PATCH re-pins.
 *
 * A storage group (route-groups.ts): boards are server storage, so root admits
 * member tier and up, and board access resolves as for tasks. A read-only
 * grantee sees the widgets and their runs; adding, re-pinning, removing and
 * logging a run against the board need write access.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { TaskUtils } from '@wolffm/task/api'
import { getBoardContext, type BoardCtx } from './route-utils'
import {
  RUN_COLS,
  Refusal,
  readSequence,
  readSequences,
  viewerOf,
  withRunNodes,
  type RunRow
} from './library-store'
import {
  ForbiddenErrorSchema,
  SequenceWidgetNotFoundErrorSchema,
  boardRefParam
} from '../schemas-errors'
import {
  AddSequenceWidgetInputSchema,
  DeletedResponseSchema,
  ListSequenceWidgetsResponseSchema,
  SequenceWidgetResponseSchema,
  UpdateSequenceWidgetInputSchema
} from '../schemas-sequences'
import type { AppContext } from '../types'

const RUN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const MAX_RUNS = 200

const json = <S extends z.ZodTypeAny>(schema: S) => ({ 'application/json': { schema } })
const forbidden = {
  description: 'Read-only on this board (FORBIDDEN)',
  content: json(ForbiddenErrorSchema)
}
const notFound = {
  description: 'Board, widget or sequence not found',
  content: json(SequenceWidgetNotFoundErrorSchema)
}
const widgetParams = boardRefParam.extend({
  widgetId: z.string().openapi({ param: { name: 'widgetId', in: 'path' } })
})

interface WidgetRow {
  id: string
  sequence_id: string
  sequence_version: number
  position: number
  created_at: string
  updated_at: string
}
const WIDGET_COLS = 'id, sequence_id, sequence_version, position, created_at, updated_at'

async function boardFor(c: Context<AppContext>, ref: string, write: boolean): Promise<BoardCtx> {
  const ctx = await getBoardContext(c, ref)
  if (!ctx || !ctx.exists) throw new Refusal(404, 'BOARD_NOT_FOUND', `Board ${ref} not found`)
  if (write && ctx.access === 'readonly') {
    throw new Refusal(403, 'FORBIDDEN', 'Read-only access to this board')
  }
  return ctx
}

/** Root's storage gate already admitted member and up, so a viewer always exists here. */
function viewer(c: Context<AppContext>) {
  const v = viewerOf(c)
  if (!v) throw new Refusal(401, 'IDENTITY_REQUIRED', 'Sign in to use sequences')
  return v
}

async function readWidget(c: Context<AppContext>, ctx: BoardCtx, id: string) {
  const row = await c.env.DB.prepare(
    `SELECT ${WIDGET_COLS} FROM board_sequences WHERE user_id = ? AND board_id = ? AND id = ?`
  )
    .bind(ctx.ownerId, ctx.boardId, id)
    .first<WidgetRow>()
  if (!row) throw new Refusal(404, 'WIDGET_NOT_FOUND', `Widget ${id} not found`)
  return row
}

async function resolveWidget(c: Context<AppContext>, row: WidgetRow) {
  const seq = await readSequence(c.env.DB, c.env, viewer(c), row.sequence_id, row.sequence_version)
  if (!seq) {
    throw new Refusal(
      404,
      'SEQUENCE_NOT_FOUND',
      `Sequence ${row.sequence_id} v${row.sequence_version} is gone`
    )
  }
  return {
    id: row.id,
    position: row.position,
    sequence: seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function createSequenceRoutes() {
  const app = new OpenAPIHono<AppContext>()

  app.openapi(
    createRoute({
      method: 'get',
      path: '/boards/{ref}/sequences',
      tags: ['Sequences'],
      summary: "A board's sequence widgets and their recent runs",
      request: { params: boardRefParam },
      responses: {
        200: { description: 'Widgets and runs', content: json(ListSequenceWidgetsResponseSchema) },
        404: notFound
      }
    }),
    async c => {
      const { ref } = c.req.valid('param')
      const ctx = await boardFor(c, ref, false)
      const v = viewer(c)
      const db = c.env.DB
      const since = new Date(Date.now() - RUN_WINDOW_MS).toISOString()
      const [rows, runs] = await db.batch([
        db
          .prepare(
            `SELECT ${WIDGET_COLS} FROM board_sequences WHERE user_id = ? AND board_id = ?
              ORDER BY position, created_at`
          )
          .bind(ctx.ownerId, ctx.boardId),
        db
          .prepare(
            `SELECT ${RUN_COLS} FROM sequence_runs
              WHERE board_owner_id = ? AND board_id = ? AND started_at >= ?
              ORDER BY started_at DESC, rowid DESC LIMIT ${MAX_RUNS}`
          )
          .bind(ctx.ownerId, ctx.boardId, since)
      ])
      const widgets = rows.results as unknown as WidgetRow[]
      const resolved = await readSequences(
        db,
        c.env,
        v,
        widgets.map(w => ({ id: w.sequence_id, version: w.sequence_version }))
      )
      return c.json(
        {
          board: ref,
          canWrite: ctx.access !== 'readonly',
          // A widget whose pinned version can't be resolved has nothing to play;
          // with versions immutable and deletes soft, only an erase does that.
          widgets: widgets.flatMap(w => {
            const sequence = resolved.get(`${w.sequence_id}@${w.sequence_version}`)
            return sequence
              ? [
                  {
                    id: w.id,
                    position: w.position,
                    sequence,
                    createdAt: w.created_at,
                    updatedAt: w.updated_at
                  }
                ]
              : []
          }),
          runs: await withRunNodes(db, v, runs.results as unknown as RunRow[])
        },
        200
      )
    }
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/boards/{ref}/sequences',
      tags: ['Sequences'],
      summary: 'Put a library sequence on a board',
      description:
        'Pins `version`, or the latest. A sequence deleted from the library cannot be added.',
      request: { params: boardRefParam, body: { content: json(AddSequenceWidgetInputSchema) } },
      responses: {
        200: { description: 'Widget added', content: json(SequenceWidgetResponseSchema) },
        403: forbidden,
        404: notFound
      }
    }),
    async c => {
      const { ref } = c.req.valid('param')
      const body = c.req.valid('json')
      const ctx = await boardFor(c, ref, true)
      const db = c.env.DB
      const seq = await readSequence(db, c.env, viewer(c), body.sequenceId, body.version)
      if (!seq || seq.deleted) {
        throw new Refusal(404, 'SEQUENCE_NOT_FOUND', `Sequence ${body.sequenceId} not found`)
      }
      const id = TaskUtils.generateULID()
      const at = new Date().toISOString()
      await db
        .prepare(
          `INSERT INTO board_sequences
             (user_id, board_id, id, sequence_id, sequence_version, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?,
                   (SELECT COALESCE(MAX(position) + 1, 0) FROM board_sequences WHERE user_id = ? AND board_id = ?),
                   ?, ?)`
        )
        .bind(ctx.ownerId, ctx.boardId, id, seq.id, seq.version, ctx.ownerId, ctx.boardId, at, at)
        .run()
      const widget = await resolveWidget(c, await readWidget(c, ctx, id))
      return c.json({ ok: true as const, widget }, 200)
    }
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/boards/{ref}/sequences/{widgetId}',
      tags: ['Sequences'],
      summary: 'Re-pin a widget to another version, or reorder it',
      request: { params: widgetParams, body: { content: json(UpdateSequenceWidgetInputSchema) } },
      responses: {
        200: { description: 'Widget updated', content: json(SequenceWidgetResponseSchema) },
        403: forbidden,
        404: notFound
      }
    }),
    async c => {
      const { ref, widgetId } = c.req.valid('param')
      const patch = c.req.valid('json')
      const ctx = await boardFor(c, ref, true)
      const row = await readWidget(c, ctx, widgetId)
      let version = row.sequence_version
      if (patch.version !== undefined && patch.version !== row.sequence_version) {
        const seq = await readSequence(c.env.DB, c.env, viewer(c), row.sequence_id, patch.version)
        if (!seq) {
          throw new Refusal(404, 'SEQUENCE_NOT_FOUND', `Sequence has no version ${patch.version}`)
        }
        version = seq.version
      }
      await c.env.DB.prepare(
        `UPDATE board_sequences SET sequence_version = ?, position = ?, updated_at = ?
          WHERE user_id = ? AND board_id = ? AND id = ?`
      )
        .bind(
          version,
          patch.position ?? row.position,
          new Date().toISOString(),
          ctx.ownerId,
          ctx.boardId,
          widgetId
        )
        .run()
      const widget = await resolveWidget(c, await readWidget(c, ctx, widgetId))
      return c.json({ ok: true as const, widget }, 200)
    }
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/boards/{ref}/sequences/{widgetId}',
      tags: ['Sequences'],
      summary: 'Take a sequence off a board',
      description:
        'The sequence stays in the library, and the runs stay in each runner’s own history.',
      request: { params: widgetParams },
      responses: {
        200: { description: 'Widget removed', content: json(DeletedResponseSchema) },
        403: forbidden,
        404: notFound
      }
    }),
    async c => {
      const { ref, widgetId } = c.req.valid('param')
      const ctx = await boardFor(c, ref, true)
      const res = await c.env.DB.prepare(
        'DELETE FROM board_sequences WHERE user_id = ? AND board_id = ? AND id = ?'
      )
        .bind(ctx.ownerId, ctx.boardId, widgetId)
        .run()
      if (!res.meta.changes)
        throw new Refusal(404, 'WIDGET_NOT_FOUND', `Widget ${widgetId} not found`)
      return c.json({ ok: true as const, deleted: widgetId }, 200)
    }
  )

  return app
}
