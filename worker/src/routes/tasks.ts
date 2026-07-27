/**
 * Task Routes
 *
 * Handles task CRUD operations and task-related endpoints
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { TaskHandlers } from '@wolffm/task/api'
import { badRequest, requireFields } from '@wolffm/worker-utils'
import { logRequest, logError } from '../logger'
import {
  handleBoardOperation,
  parseIfMatch,
  getBoardContext,
  boardRefFrom,
  withoutBoardRef
} from './route-utils'
import type { AppContext } from '../types'
import {
  GetTasksResponseSchema,
  CreateTaskInputSchema,
  CreateTaskResponseSchema,
  UpdateTaskInputSchema,
  UpdateTaskResponseSchema,
  CompleteTaskResponseSchema,
  DeleteTaskResponseSchema,
  GetStatsResponseSchema,
  ErrorResponseSchema
} from '../schemas'

/**
 * Every task route takes the board reference the SAME way (§7.1): `board` (or
 * its older name `boardId`) as a query parameter, and — on the routes that carry
 * a body — in the body as well, which wins. Create used to be body-only and
 * delete query-only, so an integrator driving both had to encode one board two
 * ways.
 */
const BOARD_REF_DESC =
  'Board reference: your own board id, or the `handle` of a board shared with you. ' +
  'Accepted as a query parameter on every task route, and in the body on routes that have one ' +
  '(body wins). Defaults to "main".'

const boardQuery = z.object({
  board: z.string().optional().openapi({ example: 'main', description: BOARD_REF_DESC }),
  boardId: z
    .string()
    .optional()
    .openapi({ example: 'main', description: 'Older name for `board`; identical behaviour.' })
})

export function createTaskRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // Get Tasks for a Board
  const getTasksRoute = createRoute({
    method: 'get',
    path: '/tasks',
    tags: ['Tasks'],
    summary: 'Get tasks for a board',
    description: 'Returns all tasks for the specified board (defaults to main)',
    request: {
      query: boardQuery
    },
    responses: {
      200: {
        description: 'List of tasks',
        content: {
          'application/json': {
            schema: GetTasksResponseSchema
          }
        }
      }
    }
  })

  app.openapi(getTasksRoute, (async (c: any) => {
    const boardId = boardRefFrom(c)

    logRequest('GET', '/task/api/tasks', {
      userType: c.get('authContext').userType,
      boardId
    })

    // Return the board's optimistic-concurrency version alongside tasks (body + ETag)
    // so clients can hold it and present If-Match on later writes. Additive — legacy
    // clients ignore the extra field/header. Board-aware (§7): a shared board reads
    // the owner's tasks; readonly access still reads fine.
    const ctx = await getBoardContext(c, boardId)
    if (!ctx) return c.json({ error: `Board ${boardId} not found`, code: 'BOARD_NOT_FOUND' }, 404)
    const file = await ctx.storage.getTasks(ctx.auth.userType, ctx.auth.sessionId, ctx.boardId)
    const version = file.version ?? 1
    c.header('ETag', `"${version}"`)
    return c.json({ tasks: file.tasks, version })
  }) as never)

  // Create Task
  const createTaskRoute = createRoute({
    method: 'post',
    path: '/',
    tags: ['Tasks'],
    summary: 'Create a new task',
    description:
      'Creates a new task on the specified board. Give it `date` (or `startTime`/`endTime`) ' +
      "and it is on that board's calendar; omit them and it lives in board view only.",
    request: {
      query: boardQuery,
      body: {
        content: {
          'application/json': {
            schema: CreateTaskInputSchema
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Task created successfully',
        content: {
          'application/json': {
            schema: CreateTaskResponseSchema
          }
        }
      },
      400: {
        description: 'Invalid request',
        content: {
          'application/json': {
            schema: ErrorResponseSchema
          }
        }
      }
    }
  })

  app.openapi(createTaskRoute, (async (c: any) => {
    const body = c.req.valid('json')
    const boardId = boardRefFrom(c, body)
    const input = withoutBoardRef(body)

    // Validate required fields
    const error = requireFields(input, ['id', 'title'])
    if (error) {
      logError('POST', '/task/api', error)
      return badRequest(c, error)
    }

    logRequest('POST', '/task/api', {
      userType: c.get('authContext').userType,
      boardId,
      taskId: input.id
    })

    const expectedVersion = parseIfMatch(c)
    return handleBoardOperation(
      c,
      boardId,
      (storage, auth, bid) => TaskHandlers.createTask(storage, auth, input, bid, expectedVersion),
      { write: true, laneTag: input.tag ?? null }
    )
  }) as never)

  // Update Task
  const updateTaskRoute = createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Tasks'],
    summary: 'Update a task',
    description: 'Updates an existing task',
    request: {
      params: z.object({
        id: z.string().openapi({ example: '01HXYZ123ABC' })
      }),
      query: boardQuery,
      body: {
        content: {
          'application/json': {
            schema: UpdateTaskInputSchema
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Task updated successfully',
        content: {
          'application/json': {
            schema: UpdateTaskResponseSchema
          }
        }
      },
      400: {
        description: 'Invalid request',
        content: {
          'application/json': {
            schema: ErrorResponseSchema
          }
        }
      }
    }
  })

  app.openapi(updateTaskRoute, (async (c: any) => {
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const boardId = boardRefFrom(c, body)

    logRequest('PATCH', '/task/api/:id', {
      userType: c.get('authContext').userType,
      taskId: id,
      boardId
    })

    const input = withoutBoardRef(body)
    const expectedVersion = parseIfMatch(c)
    // Only enforce lanes when this update actually changes the tag (§5.2); an
    // edit that leaves `tag` untouched must not be gated by the board's lanes.
    const laneOpts = 'tag' in input ? { laneTag: (input as { tag?: string }).tag ?? null } : {}
    return handleBoardOperation(
      c,
      boardId,
      (storage, auth, bid) =>
        TaskHandlers.updateTask(
          storage,
          auth,
          id,
          input as Record<string, unknown>,
          bid,
          expectedVersion
        ),
      { write: true, ...laneOpts }
    )
  }) as never)

  // Complete Task
  const completeTaskRoute = createRoute({
    method: 'post',
    path: '/{id}/complete',
    tags: ['Tasks'],
    summary: 'Complete a task (toggle)',
    description:
      'Marks a task completed. The task is NOT removed: it stays on the board struck through ' +
      'for 24h, then closes out of view on its own. Calling this on an already-completed task ' +
      'REOPENS it — the response `state` says which way the toggle went. Use DELETE to dismiss ' +
      'a task immediately.',
    request: {
      params: z.object({
        id: z.string().openapi({ example: '01HXYZ123ABC' })
      }),
      query: boardQuery
    },
    responses: {
      200: {
        description: 'Task completed successfully',
        content: {
          'application/json': {
            schema: CompleteTaskResponseSchema
          }
        }
      },
      400: {
        description: 'Invalid request',
        content: {
          'application/json': {
            schema: ErrorResponseSchema
          }
        }
      }
    }
  })

  app.openapi(completeTaskRoute, (async (c: any) => {
    const { id } = c.req.valid('param')
    const boardId = boardRefFrom(c)

    logRequest('POST', '/task/api/:id/complete', {
      userType: c.get('authContext').userType,
      taskId: id,
      boardId
    })

    const expectedVersion = parseIfMatch(c)
    return handleBoardOperation(
      c,
      boardId,
      (storage, auth, bid) => TaskHandlers.completeTask(storage, auth, id, bid, expectedVersion),
      { write: true }
    )
  }) as never)

  // Delete Task
  const deleteTaskRoute = createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Tasks'],
    summary: 'Delete a task',
    description: 'Deletes a task',
    request: {
      params: z.object({
        id: z.string().openapi({ example: '01HXYZ123ABC' })
      }),
      query: boardQuery
    },
    responses: {
      200: {
        description: 'Task deleted successfully',
        content: {
          'application/json': {
            schema: DeleteTaskResponseSchema
          }
        }
      },
      400: {
        description: 'Invalid request',
        content: {
          'application/json': {
            schema: ErrorResponseSchema
          }
        }
      }
    }
  })

  app.openapi(deleteTaskRoute, (async (c: any) => {
    const { id } = c.req.valid('param')
    const boardId = boardRefFrom(c)

    logRequest('DELETE', '/task/api/:id', {
      userType: c.get('authContext').userType,
      taskId: id,
      boardId
    })

    const expectedVersion = parseIfMatch(c)
    return handleBoardOperation(
      c,
      boardId,
      (storage, auth, bid) => TaskHandlers.deleteTask(storage, auth, id, bid, expectedVersion),
      { write: true }
    )
  }) as never)

  // Get Board Stats
  const getStatsRoute = createRoute({
    method: 'get',
    path: '/stats',
    tags: ['Tasks'],
    summary: 'Get board statistics',
    description: 'Returns statistics for the specified board',
    request: {
      query: boardQuery
    },
    responses: {
      200: {
        description: 'Board statistics',
        content: {
          'application/json': {
            schema: GetStatsResponseSchema
          }
        }
      }
    }
  })

  app.openapi(getStatsRoute, (async (c: any) => {
    const boardId = boardRefFrom(c)

    logRequest('GET', '/task/api/stats', {
      userType: c.get('authContext').userType,
      boardId
    })

    const ctx = await getBoardContext(c, boardId)
    if (!ctx) return c.json({ error: `Board ${boardId} not found`, code: 'BOARD_NOT_FOUND' }, 404)
    const result = await TaskHandlers.getBoardStats(ctx.storage, ctx.auth, ctx.boardId)
    return c.json(result)
  }) as never)

  return app
}
