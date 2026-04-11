/**
 * Task Routes
 *
 * Handles task CRUD operations and task-related endpoints
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { TaskHandlers } from '@wolffm/task/api'
import { badRequest, logRequest, logError, requireFields, extractField } from '@wolffm/worker-utils'
import { handleOperation, handleBoardOperation } from './route-utils'
import { DEFAULT_BOARD_ID } from '../constants'
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
      query: z.object({
        boardId: z.string().optional().openapi({ example: 'main' })
      })
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
    const { boardId = 'main' } = c.req.valid('query')

    logRequest('GET', '/task/api/tasks', {
      userType: c.get('authContext').userType,
      boardId
    })

    return handleOperation(c, (storage, auth) => TaskHandlers.getBoardTasks(storage, auth, boardId))
  }) as never)

  // Create Task
  const createTaskRoute = createRoute({
    method: 'post',
    path: '/',
    tags: ['Tasks'],
    summary: 'Create a new task',
    description: 'Creates a new task on the specified board',
    request: {
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
    const { boardId = DEFAULT_BOARD_ID, ...input } = body

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

    return handleBoardOperation(c, boardId, (storage, auth) =>
      TaskHandlers.createTask(storage, auth, input, boardId)
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
    const boardId: string =
      body.boardId || extractField(c, ['query:boardId'], DEFAULT_BOARD_ID) || DEFAULT_BOARD_ID

    logRequest('PATCH', '/task/api/:id', {
      userType: c.get('authContext').userType,
      taskId: id,
      boardId
    })

    const { boardId: _, ...input } = body
    return handleBoardOperation(c, boardId, (storage, auth) =>
      TaskHandlers.updateTask(storage, auth, id, input as Record<string, unknown>, boardId)
    )
  }) as never)

  // Complete Task
  const completeTaskRoute = createRoute({
    method: 'post',
    path: '/{id}/complete',
    tags: ['Tasks'],
    summary: 'Complete a task',
    description: 'Marks a task as completed',
    request: {
      params: z.object({
        id: z.string().openapi({ example: '01HXYZ123ABC' })
      }),
      query: z.object({
        boardId: z.string().optional().openapi({ example: 'main' })
      })
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
    const { boardId = DEFAULT_BOARD_ID } = c.req.valid('query')

    logRequest('POST', '/task/api/:id/complete', {
      userType: c.get('authContext').userType,
      taskId: id,
      boardId
    })

    return handleBoardOperation(c, boardId, (storage, auth) =>
      TaskHandlers.completeTask(storage, auth, id, boardId)
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
      query: z.object({
        boardId: z.string().optional().openapi({ example: 'main' })
      })
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
    const { boardId = DEFAULT_BOARD_ID } = c.req.valid('query')

    logRequest('DELETE', '/task/api/:id', {
      userType: c.get('authContext').userType,
      taskId: id,
      boardId
    })

    return handleBoardOperation(c, boardId, (storage, auth) =>
      TaskHandlers.deleteTask(storage, auth, id, boardId)
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
      query: z.object({
        boardId: z.string().optional().openapi({ example: 'main' })
      })
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
    const { boardId = 'main' } = c.req.valid('query')

    logRequest('GET', '/task/api/stats', {
      userType: c.get('authContext').userType,
      boardId
    })

    return handleOperation(c, (storage, auth) => TaskHandlers.getBoardStats(storage, auth, boardId))
  }) as never)

  return app
}
