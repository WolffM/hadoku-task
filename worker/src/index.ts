/**
 * Task API Worker Handler
 *
 * Exports a factory function that creates the Hono/Cloudflare Worker app.
 * The core business logic resides in @wolffm/task/api (src/server/).
 *
 * Usage in thin wrapper:
 * ```ts
 * import { createTaskHandler } from '@wolffm/task/worker';
 * export default createTaskHandler();
 * ```
 *
 * OpenAPI spec available at /task/api/openapi.json
 */
import { OpenAPIHono } from '@hono/zod-openapi'
import {
  createHadokuAuth,
  createCorsMiddleware,
  DEFAULT_HADOKU_ORIGINS,
  logError,
  simpleValidationHook,
  createErrorHandlers,
  createOpenAPIDocConfig,
  type HadokuAuthContext
} from '@wolffm/worker-utils'
import {
  checkThrottle,
  recordIncident,
  blacklistSession,
  THROTTLE_THRESHOLDS,
  type IncidentRecord
} from './throttle'
import { DEFAULT_SESSION_ID } from './constants'

// Import route modules
import { createSessionRoutes } from './routes/session'
import { createPreferencesRoutes } from './routes/preferences'
import { createBoardRoutes } from './routes/boards'
import { createTaskRoutes } from './routes/tasks'
import { createTagsBatchRoutes } from './routes/tags-batch'
import { createAdminRoutes } from './routes/admin'
import { createMiscRoutes } from './routes/misc'

interface Env {
  ADMIN_KEYS?: string
  FRIEND_KEYS?: string
  TASKS_KV: KVNamespace
  DB: D1Database
}

/**
 * Extended auth context for task-api
 *
 * Extends HadokuAuthContext with:
 * - sessionId: Used as KV storage key prefix (actually the credential, not browser session)
 * - key: Alias for credential (backward compat for throttle middleware)
 */
interface TaskAuthExtension {
  sessionId: string
  key: string | undefined
  [key: string]: unknown
}

// Define a custom context type for Hono
interface AppContext {
  Bindings: Env
  Variables: {
    authContext: HadokuAuthContext & TaskAuthExtension
  }
}

/**
 * Create the Task API Hono app.
 * Returns a Hono instance suitable for use as a Cloudflare Worker default export.
 */
export function createTaskHandler(): OpenAPIHono<AppContext> {
  const app = new OpenAPIHono<AppContext>({
    defaultHook: simpleValidationHook
  })

  // ============================================================================
  // Middleware Stack
  // ============================================================================

  // 1. CORS Middleware
  app.use(
    '*',
    createCorsMiddleware({
      origins: [...DEFAULT_HADOKU_ORIGINS, 'https://task-api.hadoku.me'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-User-Key', 'X-Session-Id'],
      exposedHeaders: ['X-Backend-Source'],
      credentials: true,
      maxAge: 86400
    })
  )

  // 2. Authentication Middleware
  // Uses standard Hadoku auth with task-api extensions for KV storage keys
  app.use(
    '*',
    createHadokuAuth<Env, TaskAuthExtension>({
      extend: base => ({
        // sessionId is used as KV key prefix (e.g., tasks:{sessionId}:{boardId})
        // Uses credential or falls back to default for public users
        sessionId: base.credential || DEFAULT_SESSION_ID,
        // key alias for backward compat (used by throttle middleware)
        key: base.credential ?? undefined
      })
    })
  )

  // 3. Throttle Middleware - Rate limiting per sessionId
  app.use('*', async (c, next) => {
    const auth = c.get('authContext')

    if (!auth) {
      console.error('[Throttle Middleware] authContext is undefined!')
      return c.json({ error: 'Auth context not available' }, 500)
    }

    const sessionId = auth.sessionId || 'public'
    const userType = auth.userType

    // Skip throttling for:
    // - Health check endpoint (monitoring)
    // - Authenticated users (admin/friend) - trusted and don't need rate limiting
    // - Validate-key endpoint - needed for initial connection, users don't have session yet
    // - Session handshake - needed for session establishment
    // This significantly reduces KV operations and prevents unnecessary usage
    const skipThrottlePaths = [
      '/task/api/health',
      '/task/api/validate-key',
      '/task/api/session/handshake'
    ]
    if (skipThrottlePaths.includes(c.req.path) || userType !== 'public') {
      return next()
    }

    // Check throttle (only for public users)
    // Wrap in try-catch to handle KV rate limit errors gracefully
    try {
      const throttleResult = await checkThrottle(c.env.TASKS_KV, sessionId, userType)

      if (!throttleResult.allowed) {
        // Record violation incident (also wrapped to prevent cascading KV errors)
        try {
          const incident: IncidentRecord = {
            timestamp: new Date().toISOString(),
            type: 'throttle_violation',
            sessionId,
            authKey: auth.key,
            userType,
            details: {
              reason: throttleResult.reason,
              violations: throttleResult.state.violations,
              path: c.req.path,
              method: c.req.method
            }
          }

          await recordIncident(c.env.TASKS_KV, incident)

          // Auto-blacklist if too many violations
          if (throttleResult.state.violations >= THROTTLE_THRESHOLDS.BLACKLIST_VIOLATION_COUNT) {
            await blacklistSession(
              c.env.TASKS_KV,
              sessionId,
              `Auto-blacklisted after ${throttleResult.state.violations} throttle violations`,
              auth.key
            )
          }
        } catch (kvError) {
          // Log but don't fail the request if incident recording fails
          console.warn('[Throttle] Failed to record incident (KV error):', kvError)
        }

        logError('THROTTLE', c.req.path, `Rate limit exceeded: ${throttleResult.reason}`)

        return c.json(
          {
            error: 'Rate limit exceeded',
            message: throttleResult.reason,
            retryAfter: 60 // seconds
          },
          429
        )
      }
    } catch (error) {
      // If KV operations fail (e.g., rate limit exceeded), log and continue
      // This prevents KV issues from breaking the API
      console.warn('[Throttle] KV operation failed, skipping throttle check:', error)
      // Continue without throttling rather than failing the request
    }

    return next()
  })

  // ============================================================================
  // Route Registration
  // ============================================================================
  // IMPORTANT: Order matters! More specific routes must come before generic ones
  // to avoid route parameter matching issues (e.g., /batch-tag before /:id)

  // Misc routes (health, validate-key, deprecated endpoints, legacy root)
  app.route('/task/api', createMiscRoutes())

  // Session management
  app.route('/task/api', createSessionRoutes())

  // Preferences
  app.route('/task/api', createPreferencesRoutes())

  // Boards
  app.route('/task/api', createBoardRoutes())

  // Tags and batch operations - MUST come before tasks to avoid /batch-tag matching /:id
  app.route('/task/api', createTagsBatchRoutes())

  // Tasks (includes stats endpoint) - Generic /:id route
  app.route('/task/api', createTaskRoutes())

  // Admin endpoints
  app.route('/task/api', createAdminRoutes())

  // ============================================================================
  // OpenAPI Spec Endpoint
  // ============================================================================

  app.doc(
    '/task/api/openapi.json',
    createOpenAPIDocConfig({
      title: 'Task API',
      version: '1.0.0',
      description: `
API for managing tasks, boards, and user preferences.

## Overview
This API provides endpoints for:
- **Tasks**: Create, read, update, delete, and complete tasks
- **Boards**: Organize tasks into boards
- **Tags**: Categorize tasks with tags
- **Batch Operations**: Bulk updates for tags and task movement
- **Preferences**: User settings and configuration
- **Sessions**: Session management and handshake

## Authentication
- **Public endpoints**: Basic read access without authentication
- **Authenticated endpoints**: Full access via X-User-Key header
- User types: admin, friend, public

## Rate Limiting
- Public users are rate-limited to prevent abuse
- Authenticated users (admin/friend) bypass rate limiting
		`,
      production: 'https://task-api.hadoku.workers.dev',
      tags: [
        { name: 'Health', description: 'Health check endpoints' },
        { name: 'Tasks', description: 'Task CRUD operations' },
        { name: 'Boards', description: 'Board management' },
        { name: 'Tags', description: 'Tag management' },
        { name: 'Batch', description: 'Batch operations' },
        { name: 'Session', description: 'Session management' },
        { name: 'Preferences', description: 'User preferences' },
        { name: 'Admin', description: 'Admin operations (requires admin access)' }
      ]
    })
  )

  // Error handlers
  const { notFoundHandler, errorHandler } = createErrorHandlers('simple')
  app.notFound(notFoundHandler)
  app.onError(errorHandler)

  return app
}
