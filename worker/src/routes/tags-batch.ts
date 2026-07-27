/**
 * Tags and Batch Operations Routes
 *
 * Handles tag management and batch operations on tasks
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { TaskHandlers, BoardSchemaLockedError } from '@wolffm/task/api'
import { badRequest, requireFields } from '@wolffm/worker-utils'
import { logRequest, logError } from '../logger'
import {
  getContext,
  handleOperation,
  handleBatchOperation,
  withBoardLock,
  boardLockKey
} from './route-utils'
import { getBoardConfig } from './board-automation'
import { DEFAULT_SESSION_ID } from '../constants'
import type { AppContext } from '../types'

/**
 * Guard a structural tag mutation against an automation board (§5.2). The lane
 * set is immutable while `mode = 'automation'`; createTag/deleteTag/batchClearTag
 * throw 409 BOARD_SCHEMA_LOCKED. Scoped to the caller's own board (activation is
 * owner-only, so only an owner ever has an automation board to lock).
 */
async function assertBoardNotLocked(c: any, boardId: string): Promise<void> {
  const auth = c.get('authContext')
  const ownerId = auth?.sessionId ?? DEFAULT_SESSION_ID
  const cfg = await getBoardConfig(c.env.DB, ownerId, boardId)
  if (cfg && cfg.mode === 'automation') {
    throw new BoardSchemaLockedError()
  }
}
import {
  CreateTagInputSchema,
  CreateTagResponseSchema,
  DeleteTagInputSchema,
  DeleteTagResponseSchema,
  BatchUpdateTagsInputSchema,
  BatchUpdateTagsResponseSchema,
  BatchMoveTasksInputSchema,
  BatchMoveTasksResponseSchema,
  BatchClearTagInputSchema,
  BatchClearTagResponseSchema,
  ErrorResponseSchema
} from '../schemas'

export function createTagsBatchRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // ============================================================================
  // Tag Management
  // ============================================================================

  // Create Tag
  const createTagRoute = createRoute({
    method: 'post',
    path: '/tags',
    tags: ['Tags'],
    summary: 'Create a tag',
    description: 'Adds a new tag to a board',
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreateTagInputSchema
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Tag created successfully',
        content: {
          'application/json': {
            schema: CreateTagResponseSchema
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

  app.openapi(createTagRoute, (async (c: any) => {
    const body = c.req.valid('json')

    const error = requireFields(body, ['boardId', 'tag'])
    if (error) {
      logError('POST', '/task/api/tags', error)
      return badRequest(c, error)
    }

    logRequest('POST', '/task/api/tags', {
      userType: c.get('authContext').userType,
      boardId: body.boardId,
      tag: body.tag
    })

    await assertBoardNotLocked(c, body.boardId)
    return handleOperation(c, (storage, auth) => TaskHandlers.createTag(storage, auth, body))
  }) as never)

  // Delete Tag
  const deleteTagRoute = createRoute({
    method: 'post',
    path: '/tags/delete',
    tags: ['Tags'],
    summary: 'Delete a tag',
    description: 'Removes a tag from a board (POST to avoid DELETE body issues with proxies)',
    request: {
      body: {
        content: {
          'application/json': {
            schema: DeleteTagInputSchema
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Tag deleted successfully',
        content: {
          'application/json': {
            schema: DeleteTagResponseSchema
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

  app.openapi(deleteTagRoute, (async (c: any) => {
    const body = c.req.valid('json')

    const error = requireFields(body, ['boardId', 'tag'])
    if (error) {
      logError('POST', '/task/api/tags/delete', error)
      return badRequest(c, error)
    }

    logRequest('POST', '/task/api/tags/delete', {
      userType: c.get('authContext').userType,
      boardId: body.boardId,
      tag: body.tag
    })

    await assertBoardNotLocked(c, body.boardId)
    return handleOperation(c, (storage, auth) => TaskHandlers.deleteTag(storage, auth, body))
  }) as never)

  // ============================================================================
  // Batch Operations
  // ============================================================================

  // Batch Update Tags (with boardId in URL)
  const batchUpdateTagsWithParamRoute = createRoute({
    method: 'post',
    path: '/boards/{boardId}/tasks/batch/update-tags',
    tags: ['Batch'],
    summary: 'Batch update tags',
    description: 'Updates tags on multiple tasks in a single operation',
    request: {
      params: z.object({
        boardId: z.string().openapi({ example: 'main' })
      }),
      body: {
        content: {
          'application/json': {
            schema: BatchUpdateTagsInputSchema
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Tags updated successfully',
        content: {
          'application/json': {
            schema: BatchUpdateTagsResponseSchema
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

  app.openapi(batchUpdateTagsWithParamRoute, (async (c: any) => {
    const { boardId: boardIdFromParam } = c.req.valid('param')
    const body = c.req.valid('json')
    const boardId = boardIdFromParam || body.boardId || 'main'

    logRequest('POST', '/task/api/boards/:boardId/tasks/batch/update-tags', {
      userType: c.get('authContext').userType,
      boardId
    })

    const error = requireFields(body, ['updates'])
    if (error) {
      return badRequest(c, error)
    }

    const { storage, auth } = getContext(c)
    const boardsKey = boardLockKey(auth.sessionId, boardId)

    const result = await withBoardLock(boardsKey, async () => {
      return TaskHandlers.batchUpdateTags(storage, auth, { ...body, boardId })
    })

    return c.json(result, 200)
  }) as never)

  // Batch Update Tags (legacy alias)
  const batchUpdateTagsLegacyRoute = createRoute({
    method: 'patch',
    path: '/batch-tag',
    tags: ['Batch'],
    summary: 'Batch update tags (legacy)',
    description: 'Legacy alias for batch tag updates',
    request: {
      body: {
        content: {
          'application/json': {
            schema: BatchUpdateTagsInputSchema
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Tags updated successfully',
        content: {
          'application/json': {
            schema: BatchUpdateTagsResponseSchema
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

  app.openapi(batchUpdateTagsLegacyRoute, (async (c: any) => {
    const body = c.req.valid('json')
    const boardId = body.boardId || 'main'

    logRequest('PATCH', '/task/api/batch-tag', {
      userType: c.get('authContext').userType,
      boardId
    })

    const error = requireFields(body, ['updates'])
    if (error) {
      return badRequest(c, error)
    }

    const { storage, auth } = getContext(c)
    const boardsKey = boardLockKey(auth.sessionId, boardId)

    const result = await withBoardLock(boardsKey, async () => {
      return TaskHandlers.batchUpdateTags(storage, auth, { ...body, boardId })
    })

    return c.json(result, 200)
  }) as never)

  // Batch Move Tasks
  const batchMoveTasksRoute = createRoute({
    method: 'post',
    path: '/batch/move-tasks',
    tags: ['Batch'],
    summary: 'Batch move tasks',
    description: 'Moves multiple tasks from one board to another',
    request: {
      body: {
        content: {
          'application/json': {
            schema: BatchMoveTasksInputSchema
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Tasks moved successfully',
        content: {
          'application/json': {
            schema: BatchMoveTasksResponseSchema
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

  app.openapi(batchMoveTasksRoute, (async (c: any) => {
    logRequest('POST', '/task/api/batch/move-tasks', {
      userType: c.get('authContext').userType
    })

    return handleBatchOperation(
      c,
      ['sourceBoardId', 'targetBoardId', 'taskIds'],
      (storage, auth, body) =>
        TaskHandlers.batchMoveTasks(
          storage,
          auth,
          body as { sourceBoardId: string; targetBoardId: string; taskIds: string[] }
        ),
      (body, sessionId) => [
        boardLockKey(sessionId, body.sourceBoardId as string),
        boardLockKey(sessionId, body.targetBoardId as string)
      ]
    )
  }) as never)

  // Batch Move Tasks (legacy alias)
  const batchMoveLegacyRoute = createRoute({
    method: 'post',
    path: '/batch-move',
    tags: ['Batch'],
    summary: 'Batch move tasks (legacy)',
    description: 'Legacy alias for batch move tasks',
    request: {
      body: {
        content: {
          'application/json': {
            schema: BatchMoveTasksInputSchema
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Tasks moved successfully',
        content: {
          'application/json': {
            schema: BatchMoveTasksResponseSchema
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

  app.openapi(batchMoveLegacyRoute, (async (c: any) => {
    logRequest('POST', '/task/api/batch-move', {
      userType: c.get('authContext').userType
    })

    return handleBatchOperation(
      c,
      ['sourceBoardId', 'targetBoardId', 'taskIds'],
      (storage, auth, body) =>
        TaskHandlers.batchMoveTasks(
          storage,
          auth,
          body as { sourceBoardId: string; targetBoardId: string; taskIds: string[] }
        ),
      (body, sessionId) => [
        boardLockKey(sessionId, body.sourceBoardId as string),
        boardLockKey(sessionId, body.targetBoardId as string)
      ]
    )
  }) as never)

  // Batch Clear Tag
  const batchClearTagRoute = createRoute({
    method: 'post',
    path: '/batch-clear-tag',
    tags: ['Batch'],
    summary: 'Batch clear tag',
    description: 'Removes a specific tag from multiple tasks',
    request: {
      body: {
        content: {
          'application/json': {
            schema: BatchClearTagInputSchema
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Tag cleared from tasks successfully',
        content: {
          'application/json': {
            schema: BatchClearTagResponseSchema
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

  app.openapi(batchClearTagRoute, (async (c: any) => {
    const preview = await c.req.json()
    logRequest('POST', '/task/api/batch-clear-tag', {
      userType: c.get('authContext').userType
    })

    if (preview?.boardId) await assertBoardNotLocked(c, preview.boardId)
    return handleBatchOperation(
      c,
      ['boardId', 'tag', 'taskIds'],
      (storage, auth, body) =>
        TaskHandlers.batchClearTag(
          storage,
          auth,
          body as { boardId: string; tag: string; taskIds: string[] }
        ),
      (body, sessionId) => [boardLockKey(sessionId, body.boardId as string)]
    )
  }) as never)

  return app
}
