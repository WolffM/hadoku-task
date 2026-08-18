/**
 * Miscellaneous Routes
 *
 * Handles utility endpoints: health check, key validation
 */
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { tierAtLeast } from '@wolffm/worker-utils'
import { logRequest } from '../logger'
import type { AppContext } from '../types'
import { HealthResponseSchema, ValidateKeyResponseSchema } from '../schemas'

export function createMiscRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // Health Check
  const healthRoute = createRoute({
    method: 'get',
    path: '/health',
    tags: ['Health'],
    summary: 'Health check',
    description: 'Returns the health status of the API',
    responses: {
      200: {
        description: 'API is healthy',
        content: {
          'application/json': {
            schema: HealthResponseSchema
          }
        }
      }
    }
  })

  // Inlined rather than delegated to worker-utils' healthCheck(), which returns
  // a bare Response and so cannot be checked against this route. The body is
  // byte-identical to what it built: it derives status from the checks, and the
  // only check passed here is a hardcoded `true`, so it always answered 200/ok.
  app.openapi(healthRoute, c =>
    c.json(
      {
        status: 'ok' as const,
        service: 'task-api-adapter',
        timestamp: new Date().toISOString(),
        checks: { kv: true }
      },
      200
    )
  )

  // Validate Key
  const validateKeyRoute = createRoute({
    method: 'post',
    path: '/validate-key',
    tags: ['Health'],
    summary: 'Validate API key',
    description: 'Checks if the key provided in X-User-Key header is valid',
    responses: {
      200: {
        description: 'Key validation result',
        content: {
          'application/json': {
            schema: ValidateKeyResponseSchema
          }
        }
      }
    }
  })

  app.openapi(validateKeyRoute, c => {
    const authContext = c.get('authContext')
    const userType = authContext.userType
    const valid = tierAtLeast(authContext, 'friend')
    // Edge-injected stable identity (see TaskAuthExtension.userId). Surfacing it
    // lets a caller discover the id its data is keyed under, and is the signal
    // that confirms edge-router's X-User-Id injection is reaching this worker.
    const userId = authContext.userId

    logRequest('POST', '/task/api/validate-key', {
      valid,
      userType,
      hasKey: !!authContext.key,
      hasUserId: !!userId
    })

    return c.json({ valid, userType, ...(userId ? { userId } : {}) }, 200)
  })

  return app
}
