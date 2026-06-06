/**
 * Session Routes
 *
 * Handles session handshake endpoint for establishing and migrating sessions
 */
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { badRequest, maskKey, maskSessionId } from '@wolffm/worker-utils'
import { logRequest, logError } from '../logger'
import { handleSessionHandshake } from '../session'
import type { AppContext } from '../types'
import {
  SessionHandshakeInputSchema,
  SessionHandshakeResponseSchema,
  ErrorResponseSchema
} from '../schemas'

export function createSessionRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // Session Handshake
  const handshakeRoute = createRoute({
    method: 'post',
    path: '/session/handshake',
    tags: ['Session'],
    summary: 'Session handshake',
    description: `Establishes a new session and migrates preferences from:
1. oldSessionId (if provided)
2. session-map (authKey → lastSessionId)
3. legacy prefs:authKey
4. defaults (if none found)`,
    request: {
      body: {
        content: {
          'application/json': {
            schema: SessionHandshakeInputSchema
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Session established successfully',
        content: {
          'application/json': {
            schema: SessionHandshakeResponseSchema
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

  app.openapi(handshakeRoute, (async (c: any) => {
    try {
      const auth = c.get('authContext')
      const body = c.req.valid('json')

      if (!body.newSessionId) {
        return badRequest(c, 'newSessionId is required')
      }

      const authKey = auth.key || auth.sessionId || 'public'

      logRequest('POST', '/task/api/session/handshake', {
        userType: auth.userType,
        authKey: maskKey(authKey),
        oldSessionId: body.oldSessionId ? maskSessionId(body.oldSessionId) : null,
        newSessionId: maskSessionId(body.newSessionId)
      })

      const response = await handleSessionHandshake(
        c.env.TASKS_KV,
        authKey,
        auth.userType as 'admin' | 'friend' | 'public',
        body
      )

      return c.json(response, 200)
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logError(
        'POST',
        '/task/api/session/handshake',
        error instanceof Error ? error : new Error(errorMessage)
      )
      return badRequest(c, `Handshake failed: ${errorMessage}`)
    }
  }) as never)

  return app
}
