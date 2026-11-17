/**
 * Board Routes
 *
 * Handles board CRUD operations
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { TaskHandlers } from '@wolffm/task/api'
import { requireFields } from '@wolffm/worker-utils'
import { logRequest, logError } from '../logger'
import { StepTimer } from '../server-timing'
import { getContext, withBoardLock, parseIfMatch } from './route-utils'
import { annotatedSharesByBoard } from './share-registry'
import { liveClaimedTaskIdsForUser } from './board-claims'
import { readSharedBoards } from './d1-storage'
import { validateBoardId } from '../request-utils'
import { boardsKey } from '../kv-keys'
import type { AppContext } from '../types'
import {
  GetBoardsResponseSchema,
  CreateBoardInputSchema,
  CreateBoardResponseSchema,
  DeleteBoardResponseSchema
} from '../schemas'
import { ErrorResponseSchema } from '../schemas-common'

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
    // Each step's duration goes out as Server-Timing, which the edge stores on
    // the request row (`request_logs.server_timing`) — so the split of this
    // route's latency is readable from the log, not guessed (#110).
    const timing = new StepTimer()

    // Flag the tasks an agent is holding right now (§5.5), and attach each OWNED
    // board's grantees (§7.3) so the Edit Boards / Share UI has them up front.
    // Each is one read for the whole board list, and neither needs the list to
    // RUN — only to be applied — so both start now, beside the boards read,
    // instead of costing a round trip after it. Both are non-fatal: a board that
    // can't report claims or grantees still renders (the share panel falls back
    // to its own fetch).
    //
    // Claims are TRANSIENT by design: attached here, never stored on the task
    // row, so a cached copy is exactly as old as the read it came with — "was
    // claimed when we last looked" — and the next board sync corrects it.
    const claimsRead = auth.sessionId
      ? timing
          .step('claims', () => liveClaimedTaskIdsForUser(c.env.DB, auth.sessionId as string))
          .catch(err => {
            logError('GET', '/task/api/boards', `claim hydration failed: ${String(err)}`)
            return null
          })
      : Promise.resolve(null)
    const sharesRead = auth.sessionId
      ? timing
          .step('shares', () => annotatedSharesByBoard(c.env, auth.sessionId as string))
          .catch(err => {
            logError('GET', '/task/api/boards', `share hydration failed: ${String(err)}`)
            return null
          })
      : Promise.resolve(null)

    const boardsData = await timing.step('boards', () => TaskHandlers.getBoards(storage, auth))

    // The handler hydrates every board's tasks/stats in the CALLER's own scope
    // (`auth.sessionId`). That's correct for owned boards but wrong for boards
    // SHARED with this viewer — their task rows live under the OWNER's id, so the
    // handler's viewer-scoped read comes back empty. Re-hydrate those from the
    // owner's scope here at the route edge (where sharing is resolved, §7.1), all
    // of them in one round trip. A shared board's `id` is its globally-unique
    // handle, and it carries its `ownerUserId`.
    const shared = boardsData.boards.filter(b => b.access && b.access !== 'owner' && b.ownerUserId)
    const [contents, claimed, shares] = await Promise.all([
      shared.length
        ? timing.step('shared', () =>
            readSharedBoards(
              c.env,
              shared.map(b => ({ handle: b.id, ownerUserId: b.ownerUserId as string }))
            )
          )
        : null,
      claimsRead,
      sharesRead
    ])

    for (const board of shared) {
      const got = contents?.get(board.id)
      if (!got) continue
      board.tasks = got.tasks.map(t => (got.claimed.has(t.id) ? { ...t, claimed: true } : t))
      board.stats = got.stats
      // The calendar descriptor counts the board's dated tasks, so it has to be
      // recomputed against the tasks we just swapped in — the handler built it
      // from the viewer-scoped (empty) read.
      board.calendar = TaskHandlers.boardCalendar(board)
    }
    // Claims and grantees are the OWNED boards' own; only the owner may see who
    // a board is shared with.
    for (const board of boardsData.boards) {
      if (board.access && board.access !== 'owner') continue
      if (claimed?.size) {
        board.tasks = board.tasks.map(t => (claimed.has(t.id) ? { ...t, claimed: true } : t))
      }
      if (shares) board.shares = shares.get(board.id) ?? []
    }

    c.header('Server-Timing', timing.header())
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
    description: 'Creates a new board with the provided id and name.',
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
