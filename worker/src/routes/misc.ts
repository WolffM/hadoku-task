/**
 * Miscellaneous Routes
 *
 * Handles utility endpoints: health check, key validation
 */
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { healthCheck } from '@wolffm/worker-utils'
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

  app.openapi(healthRoute, ((c: any) => healthCheck(c, 'task-api-adapter', { kv: true })) as never)

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
    const valid = userType !== 'public'

    logRequest('POST', '/task/api/validate-key', {
      valid,
      userType,
      hasKey: !!authContext.key
    })

    return c.json({ valid, userType }, 200)
  })

  return app
}
