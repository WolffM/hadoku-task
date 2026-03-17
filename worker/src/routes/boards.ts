/**
 * Board Routes
 *
 * Handles board CRUD operations
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { TaskHandlers } from '@wolffm/task/api'
import { badRequest, logRequest, logError, requireFields } from '@wolffm/worker-utils'
import { getContext, withBoardLock } from './route-utils'
import { validateBoardId } from '../request-utils'
import { boardsKey } from '../kv-keys'
import {
  GetBoardsResponseSchema,
  CreateBoardInputSchema,
  CreateBoardResponseSchema,
  DeleteBoardResponseSchema,
  ErrorResponseSchema
} from '../schemas'

interface Env {
  TASKS_KV: KVNamespace
}

export function createBoardRoutes() {
  const app = new OpenAPIHono<{ Bindings: Env }>()

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
      return badRequest(c, error)
    }

    logRequest('POST', '/task/api/boards', {
      userType: c.get('authContext').userType,
      boardId: body.id
    })

    const { storage, auth } = getContext(c)
    const lockKey = boardsKey(auth.sessionId)

    const result = await withBoardLock(lockKey, async () => {
      return TaskHandlers.createBoard(storage, auth, body)
    })

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
      return badRequest(c, validationError)
    }

    logRequest('DELETE', `/task/api/boards/${boardId}`, {
      userType: c.get('authContext').userType,
      boardId
    })

    const { storage, auth } = getContext(c)
    const lockKey = boardsKey(auth.sessionId)

    const result = await withBoardLock(lockKey, async () => {
      return TaskHandlers.deleteBoard(storage, auth, boardId)
    })

    return c.json(result, 200)
  })

  return app
}
