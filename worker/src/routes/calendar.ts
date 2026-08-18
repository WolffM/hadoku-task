/**
 * Board calendar routes (§9).
 *
 * A calendar is a PROPERTY OF A BOARD, not a collection of its own: it is the
 * board's tasks that carry a `date` (see Task.date in src/domain/types.ts). So
 * it is addressed as a sub-resource of the board — `/boards/{ref}/calendar` —
 * the same shape sharing uses (`/boards/{ref}/shares`), and it resolves through
 * exactly the same access layer. A contributor on a shared board reads the
 * OWNER's calendar here, and writes to it with the ordinary task routes pointed
 * at the same `ref`.
 *
 * There is deliberately no calendar WRITE endpoint: a task with `date` (or
 * `startTime`/`endTime`) already IS a calendar entry, and a second write path
 * would be two ways to say one thing.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { TaskHandlers } from '@wolffm/task/api'
import { logRequest } from '../logger'
import { getBoardContext } from './route-utils'
import { getBoardConfig } from './board-automation'
import { GetBoardCalendarResponseSchema } from '../schemas'
import { BoardNotFoundErrorSchema, boardRefParam } from '../schemas-agent'
import type { AppContext } from '../types'

/** Inclusive day bound. Validated here so a bad one is the shared 400, not a silent no-op. */
const day = (example: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a "YYYY-MM-DD" day')
    .optional()
    .openapi({ example })

export function createCalendarRoutes() {
  const app = new OpenAPIHono<AppContext>()

  const getCalendarRoute = createRoute({
    method: 'get',
    path: '/boards/{ref}/calendar',
    tags: ['Calendar'],
    summary: "A board's calendar",
    description:
      "The board's scheduled tasks — everything carrying a calendar day — ordered by day then " +
      'start time. Narrow it with `from`/`to` (inclusive "YYYY-MM-DD") and/or `source` to see ' +
      'only what one provider mirrored, which is how an integration reconciles what it already ' +
      "wrote. Works on a board shared with you: pass its `handle` as `ref` to read the owner's " +
      'calendar. To WRITE, create a task on the same ref with `date` or `startTime`/`endTime` — ' +
      'that is what puts it on this calendar.',
    request: {
      params: boardRefParam,
      query: z.object({
        from: day('2026-08-01'),
        to: day('2026-08-31'),
        source: z.string().optional().openapi({
          example: 'contact',
          description: 'Only tasks mirrored from this provider (`Task.source`).'
        })
      })
    },
    responses: {
      200: {
        description: 'The board calendar',
        content: { 'application/json': { schema: GetBoardCalendarResponseSchema } }
      },
      404: {
        description: 'Board not found, or not shared with you (BOARD_NOT_FOUND)',
        content: { 'application/json': { schema: BoardNotFoundErrorSchema } }
      }
    }
  })

  app.openapi(getCalendarRoute, async c => {
    const { ref } = c.req.valid('param')
    const { from, to, source } = c.req.valid('query')

    logRequest('GET', `/task/api/boards/${ref}/calendar`, {
      userType: c.get('authContext').userType,
      boardId: ref
    })

    const ctx = await getBoardContext(c, ref)
    if (!ctx)
      return c.json({ error: `Board ${ref} not found`, code: 'BOARD_NOT_FOUND' as const }, 404)

    const result = await TaskHandlers.getBoardCalendar(ctx.storage, ctx.auth, ctx.boardId, {
      from,
      to,
      source
    })
    // Name the calendar from the board row — the ref may be a handle, which says
    // nothing about what the board is called.
    const cfg = await getBoardConfig(c.env.DB, ctx.ownerId, ctx.boardId)
    return c.json(
      {
        // Echo the reference the CALLER used, not the owner's slug: that is the one
        // that resolves for them on the next write.
        board: ref,
        calendar: {
          ref,
          name: cfg?.name ?? ctx.boardId,
          canWrite: ctx.access !== 'readonly',
          // The whole calendar, not the filtered window — `tasks` already says what
          // the window holds.
          scheduled: result.scheduled
        },
        from: result.from,
        to: result.to,
        count: result.tasks.length,
        tasks: result.tasks
      },
      200
    )
  })

  return app
}
