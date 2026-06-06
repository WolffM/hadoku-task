/**
 * Admin Routes
 *
 * Handles administrative endpoints for monitoring and management
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { maskKey, maskSessionId } from '@wolffm/worker-utils'
import { logRequest } from '../logger'
import {
  getThrottleState,
  getIncidents,
  isSessionBlacklisted,
  unblacklistSession,
  resetThrottleState,
  checkSuspiciousPatterns
} from '../throttle'
import { getSessionMapping } from '../session'
import { USER_TYPES } from '../constants'
import type { AppContext } from '../types'
import {
  GetThrottleStatusResponseSchema,
  GetSessionsResponseSchema,
  UnblacklistResponseSchema,
  ErrorResponseSchema
} from '../schemas'

export function createAdminRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // Get Throttle Status
  const getThrottleStatusRoute = createRoute({
    method: 'get',
    path: '/admin/throttle/{sessionId}',
    tags: ['Admin'],
    summary: 'Get throttle status',
    description:
      'Returns throttle state, blacklist status, and incidents for a session. Requires admin access.',
    request: {
      params: z.object({
        sessionId: z.string().openapi({ example: 'sess_abc123' })
      })
    },
    responses: {
      200: {
        description: 'Throttle status',
        content: {
          'application/json': {
            schema: GetThrottleStatusResponseSchema
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
      },
      403: {
        description: 'Admin access required',
        content: {
          'application/json': {
            schema: ErrorResponseSchema
          }
        }
      }
    }
  })

  app.openapi(getThrottleStatusRoute, (async (c: any) => {
    const auth = c.get('authContext')
    if (auth.userType !== USER_TYPES.ADMIN) {
      return c.json({ error: 'Admin access required' }, 403)
    }

    const { sessionId } = c.req.valid('param')

    const state = await getThrottleState(c.env.TASKS_KV, sessionId)
    const blacklisted = await isSessionBlacklisted(c.env.TASKS_KV, sessionId)
    const incidents = await getIncidents(c.env.TASKS_KV, sessionId)

    return c.json(
      {
        sessionId: maskSessionId(sessionId),
        throttleState: state,
        blacklisted,
        incidents,
        incidentCount: incidents.length
      },
      200
    )
  }) as never)

  // Get Sessions for Auth Key
  const getSessionsRoute = createRoute({
    method: 'get',
    path: '/admin/sessions/{authKey}',
    tags: ['Admin'],
    summary: 'Get sessions for auth key',
    description:
      'Returns all sessions associated with an authKey. Includes suspicious pattern detection. Requires admin access.',
    request: {
      params: z.object({
        authKey: z.string().openapi({ example: 'key_xyz789' })
      })
    },
    responses: {
      200: {
        description: 'Sessions for auth key',
        content: {
          'application/json': {
            schema: GetSessionsResponseSchema
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
      },
      403: {
        description: 'Admin access required',
        content: {
          'application/json': {
            schema: ErrorResponseSchema
          }
        }
      }
    }
  })

  app.openapi(getSessionsRoute, (async (c: any) => {
    const auth = c.get('authContext')
    if (auth.userType !== USER_TYPES.ADMIN) {
      return c.json({ error: 'Admin access required' }, 403)
    }

    const { authKey } = c.req.valid('param')

    const mapping = await getSessionMapping(c.env.TASKS_KV, authKey)

    if (!mapping) {
      return c.json({ authKey: maskKey(authKey), sessions: [], lastSessionId: null }, 200)
    }

    const suspiciousCheck = await checkSuspiciousPatterns(
      c.env.TASKS_KV,
      authKey,
      mapping.sessionIds
    )

    return c.json(
      {
        authKey: maskKey(authKey),
        sessionCount: mapping.sessionIds.length,
        sessions: mapping.sessionIds.map(maskSessionId),
        lastSessionId: maskSessionId(mapping.lastSessionId),
        suspicious: suspiciousCheck.suspicious,
        suspiciousReasons: suspiciousCheck.reasons
      },
      200
    )
  }) as never)

  // Unblacklist Session
  const unblacklistRoute = createRoute({
    method: 'post',
    path: '/admin/unblacklist/{sessionId}',
    tags: ['Admin'],
    summary: 'Unblacklist a session',
    description:
      'Removes a session from the blacklist and resets throttle state. Requires admin access.',
    request: {
      params: z.object({
        sessionId: z.string().openapi({ example: 'sess_abc123' })
      })
    },
    responses: {
      200: {
        description: 'Session unblacklisted successfully',
        content: {
          'application/json': {
            schema: UnblacklistResponseSchema
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
      },
      403: {
        description: 'Admin access required',
        content: {
          'application/json': {
            schema: ErrorResponseSchema
          }
        }
      }
    }
  })

  app.openapi(unblacklistRoute, (async (c: any) => {
    const auth = c.get('authContext')
    if (auth.userType !== USER_TYPES.ADMIN) {
      return c.json({ error: 'Admin access required' }, 403)
    }

    const { sessionId } = c.req.valid('param')

    await unblacklistSession(c.env.TASKS_KV, sessionId)
    await resetThrottleState(c.env.TASKS_KV, sessionId)

    logRequest('POST', `/task/api/admin/unblacklist/${maskSessionId(sessionId)}`, {
      userType: auth.userType,
      action: 'unblacklist'
    })

    return c.json(
      { success: true as const, message: `Session ${maskSessionId(sessionId)} unblacklisted` },
      200
    )
  }) as never)

  return app
}
