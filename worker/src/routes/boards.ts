/**
 * Board Routes
 *
 * Handles board CRUD operations
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { TaskHandlers } from '@wolffm/task/api'
import { requireFields } from '@wolffm/worker-utils'
import { logRequest, logError } from '../logger'
import { getContext, withBoardLock, parseIfMatch, resolveBoardCtx } from './route-utils'
import { annotatedSharesByBoard } from './share-registry'
import { validateBoardId } from '../request-utils'
import { boardsKey } from '../kv-keys'
import type { AppContext } from '../types'
import {
  GetBoardsResponseSchema,
  CreateBoardInputSchema,
  CreateBoardResponseSchema,
  DeleteBoardResponseSchema,
  ErrorResponseSchema
} from '../schemas'

export function createBoardRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // Get All Boards
  const getBoardsRoute = createRoute({
    method: 'get',
    path: '/boards',
    tags: ['Boards'],
    summary: 'Get all boards',
    description: 'Returns all boards for the current user session',
    responses: {
      200: {
        description: 'List of boards',
        content: {
          'application/json': {
            schema: GetBoardsResponseSchema
          }
        }
      }
    }
  })

  app.openapi(getBoardsRoute, async c => {
    const authContext = c.get('authContext')
    logRequest('GET', '/task/api/boards', { userType: authContext.userType })

    const { storage, auth } = getContext(c)
    const boardsData = await TaskHandlers.getBoards(storage, auth)

    // The handler hydrates every board's tasks/stats in the CALLER's own scope
    // (`auth.sessionId`). That's correct for owned boards but wrong for boards
    // SHARED with this viewer — their task rows live under the OWNER's id, so
    // the handler's viewer-scoped read comes back empty. Re-hydrate those from
    // the owner's scope here at the route edge (where sharing is resolved, §7.1),
    // in parallel so one slow owner can't stall the rest. A shared board's `id`
    // is its globally-unique handle, which resolveBoardCtx routes to the owner.
    await Promise.all(
      boardsData.boards.map(async board => {
        if (!board.access || board.access === 'owner') return
        const ctx = await resolveBoardCtx(c.env, authContext, board.id)
        if (!ctx) return
        const [tasksFile, statsFile] = await Promise.all([
          ctx.storage.getTasks(ctx.auth.userType, ctx.auth.sessionId, ctx.boardId),
          ctx.storage.getStats(ctx.auth.userType, ctx.auth.sessionId, ctx.boardId)
        ])
        board.tasks = tasksFile.tasks
        board.stats = statsFile
        // The calendar descriptor counts the board's dated tasks, so it has to be
        // recomputed against the tasks we just swapped in — the handler built it
        // from the viewer-scoped (empty) read.
        board.calendar = TaskHandlers.boardCalendar(board)
      })
    )

    // Attach each OWNED board's grantees (§7.3) so the Edit Boards / Share UI
    // has them up front instead of fetching per board when a panel opens. One
    // query + one registry scan for the whole set. Only the owner may see who a
    // board is shared with, so grantees are never attached to a board this
    // viewer merely has access to.
    if (auth.sessionId) {
      try {
        const shares = await annotatedSharesByBoard(c.env, auth.sessionId)
        for (const board of boardsData.boards) {
          if (board.access && board.access !== 'owner') continue
          board.shares = shares.get(board.id) ?? []
        }
      } catch (err) {
        // Non-fatal: boards still render, the panel falls back to its own fetch.
        logError('GET', '/task/api/boards', `share hydration failed: ${String(err)}`)
      }
    }

    // Expose the collection version as an ETag so clients can present it as
    // If-Match on the next board write (board-collection OCC).
    if (typeof boardsData.version === 'number') {
      c.header('ETag', `"${boardsData.version}"`)
    }
    return c.json(
      {
        ...boardsData,
        userType: auth.userType
      },
      200
    )
  })

  // Create a New Board
  const createBoardRoute = createRoute({
    method: 'post',
    path: '/boards',
    tags: ['Boards'],
    summary: 'Create a new board',
    description: 'Creates a new board with the provided id and name',
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateBoardInputSchema
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Board created successfully',
        content: {
          'application/json': {
            schema: CreateBoardResponseSchema
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

  app.openapi(createBoardRoute, async c => {
    const body = c.req.valid('json')

    const error = requireFields(body, ['id', 'name'])
    if (error) {
      logError('POST', '/task/api/boards', error)
      return c.json({ error: error, timestamp: new Date().toISOString() }, 400)
    }

    logRequest('POST', '/task/api/boards', {
      userType: c.get('authContext').userType,
      boardId: body.id
    })

    const { storage, auth } = getContext(c)
    const lockKey = boardsKey(auth.sessionId)
    const expectedVersion = parseIfMatch(c)

    const result = await withBoardLock(lockKey, async () => {
      return TaskHandlers.createBoard(storage, auth, body, expectedVersion)
    })

    const v = (result as unknown as { version?: number }).version
    if (typeof v === 'number') {
      c.header('ETag', `"${v}"`)
    }
    return c.json(result, 200)
  })

  // Delete a Board
  const deleteBoardRoute = createRoute({
    method: 'delete',
    path: '/boards/{boardId}',
    tags: ['Boards'],
    summary: 'Delete a board',
    description: 'Deletes a board and all associated tasks and stats',
    request: {
      params: z.object({
        boardId: z.string().openapi({ example: 'work-board' })
      })
    },
    responses: {
      200: {
        description: 'Board deleted successfully',
        content: {
          'application/json': {
            schema: DeleteBoardResponseSchema
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

  app.openapi(deleteBoardRoute, async c => {
    const { boardId } = c.req.valid('param')

    const validationError = validateBoardId(boardId)
    if (validationError) {
      logError('DELETE', '/task/api/boards/:boardId', validationError)
      return c.json({ error: validationError, timestamp: new Date().toISOString() }, 400)
    }

    logRequest('DELETE', `/task/api/boards/${boardId}`, {
      userType: c.get('authContext').userType,
      boardId
    })

    const { storage, auth } = getContext(c)
    const lockKey = boardsKey(auth.sessionId)
    const expectedVersion = parseIfMatch(c)

    const result = await withBoardLock(lockKey, async () => {
      return TaskHandlers.deleteBoard(storage, auth, boardId, expectedVersion)
    })

    const v = (result as unknown as { version?: number }).version
    if (typeof v === 'number') {
      c.header('ETag', `"${v}"`)
    }
    return c.json(result, 200)
  })

  // Update a board's metadata (rename). Goes through board-collection OCC.
  const updateBoardRoute = createRoute({
    method: 'patch',
    path: '/boards/{boardId}',
    tags: ['Boards'],
    summary: 'Update a board',
    description:
      'Renames a board. Send If-Match with the board-collection version for a safe write.',
    request: {
      params: z.object({ boardId: z.string().openapi({ example: 'work-board' }) }),
      body: {
        content: {
          'application/json': {
            schema: z.object({ name: z.string().min(1).max(100) })
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Board updated',
        content: { 'application/json': { schema: z.object({ ok: z.boolean() }).passthrough() } }
      },
      400: {
        description: 'Invalid request',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(updateBoardRoute, async c => {
    const { boardId } = c.req.valid('param')
    const body = c.req.valid('json')

    const validationError = validateBoardId(boardId)
    if (validationError) {
      logError('PATCH', '/task/api/boards/:boardId', validationError)
      return c.json({ error: validationError, timestamp: new Date().toISOString() }, 400)
    }

    logRequest('PATCH', `/task/api/boards/${boardId}`, {
      userType: c.get('authContext').userType,
      boardId
    })

    const { storage, auth } = getContext(c)
    const lockKey = boardsKey(auth.sessionId)
    const expectedVersion = parseIfMatch(c)

    const result = await withBoardLock(lockKey, async () => {
      return TaskHandlers.updateBoard(storage, auth, boardId, { name: body.name }, expectedVersion)
    })

    const v = (result as unknown as { version?: number }).version
    if (typeof v === 'number') c.header('ETag', `"${v}"`)
    return c.json(result, 200)
  })

  // Set the pinned board set + order (pin, unpin, reorder in one write).
  const setPinnedRoute = createRoute({
    method: 'put',
    path: '/boards/pinned',
    tags: ['Boards'],
    summary: 'Set pinned boards',
    description:
      'Replaces the pinned set with `order` (exact top-bar order); boards not listed become unpinned. If-Match honoured.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({ order: z.array(z.string()).max(1000) })
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Pinned set updated',
        content: { 'application/json': { schema: z.object({ ok: z.boolean() }).passthrough() } }
      },
      400: {
        description: 'Invalid request',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(setPinnedRoute, async c => {
    const body = c.req.valid('json')

    logRequest('PUT', '/task/api/boards/pinned', {
      userType: c.get('authContext').userType,
      count: body.order.length
    })

    const { storage, auth } = getContext(c)
    const lockKey = boardsKey(auth.sessionId)
    const expectedVersion = parseIfMatch(c)

    const result = await withBoardLock(lockKey, async () => {
      return TaskHandlers.setPinnedBoards(storage, auth, body.order, expectedVersion)
    })

    const v = (result as unknown as { version?: number }).version
    if (typeof v === 'number') c.header('ETag', `"${v}"`)
    return c.json(result, 200)
  })

  return app
}
