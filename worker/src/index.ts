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
import type { Context } from 'hono'
import {
  createEdgeAuth,
  createCorsMiddleware,
  DEFAULT_HADOKU_ORIGINS,
  createErrorHandlers,
  createOpenAPIDocConfig
} from '@wolffm/worker-utils'
import { logError, logger } from './logger'
import {
  checkThrottle,
  recordIncident,
  blacklistSession,
  THROTTLE_THRESHOLDS,
  type IncidentRecord,
  type ThrottledTier
} from './throttle'
import { DEFAULT_SESSION_ID } from './constants'
import { healthBody } from './routes/health'
import { ROUTE_GROUPS, type RouteGroup } from './route-groups'
import { ROUTE_MANIFEST } from './route-manifest'
import type { AppContext, TaskAuthExtension } from './types'

// NOTHING imported above may build a zod schema at module scope. Root is
// evaluated on every cold isolate, before any request is routed; each route
// group (and its schemas) loads on first use instead — see route-groups.ts.

/**
 * Tiers subject to rate limiting. See the throttle middleware below for why
 * this is a set rather than a minimum tier — it is not monotonic in rank.
 */
const THROTTLED_TIERS: ReadonlySet<string> = new Set<ThrottledTier>(['public', 'service'])

/**
 * Type guard, so the throttle branch narrows `userType` to what `checkThrottle`
 * accepts. Called inline in the early-return condition below — assigning it to
 * a boolean first would not narrow.
 */
function isThrottledTier(tier: string): tier is ThrottledTier {
  return THROTTLED_TIERS.has(tier)
}

type AuthContext = AppContext['Variables']['authContext']

/**
 * The authContext root resolved for a request, handed to the group that serves
 * it. A group runs as its own app (`shell.fetch`), which starts a fresh Context,
 * so root's `c.var` does not reach it. Passing the object itself rather than
 * re-running auth in the group keeps ONE auth + identity-scoping pass per
 * request: the throttle and the handler see the same scoping by construction.
 * Keyed by the Request, which root forwards unchanged.
 */
const forwardedAuth = new WeakMap<Request, AuthContext>()

/** Hono's `executionCtx` getter throws when the app was invoked without one —
 * `app.request()` in the verify harnesses. Absent is a legitimate state there,
 * and the group sees exactly what root saw. */
function executionCtxOf(c: Context): ExecutionContext | undefined {
  try {
    return c.executionCtx
  } catch {
    return undefined
  }
}

/**
 * Map domain errors (TaskNotFound→404, BoardNotFound→404, VersionConflict→409)
 * to their declared HTTP status before falling back to the generic 500 handler.
 * Detected structurally so it works regardless of cross-package instanceof identity.
 *
 * Installed on root AND on every group shell: a group catches its own handler's
 * throw, so root's onError never sees it.
 */
function installErrorHandlers(app: OpenAPIHono<AppContext>) {
  const { notFoundHandler, errorHandler } = createErrorHandlers('simple')
  app.notFound(notFoundHandler)
  app.onError((err, c) => {
    const domain = err as {
      httpStatus?: unknown
      code?: unknown
      message?: string
      currentVersion?: unknown
      // Extra actionable fields carried by specific DomainErrors (§4.3): the
      // claim holder + expiry on CLAIM_HELD, the current lane on LANE_CHANGED,
      // the current notes digest on NOTES_CHANGED.
      holder?: unknown
      expiresAt?: unknown
      currentLane?: unknown
      currentDigest?: unknown
      currentNotesHash?: unknown
    }
    if (typeof domain.httpStatus === 'number' && typeof domain.code === 'string') {
      const body: Record<string, unknown> = { error: domain.message ?? 'Error', code: domain.code }
      if (typeof domain.currentVersion === 'number') body.currentVersion = domain.currentVersion
      if (typeof domain.holder === 'string') body.holder = domain.holder
      if (typeof domain.expiresAt === 'string') body.expiresAt = domain.expiresAt
      if (domain.currentLane !== undefined) body.currentLane = domain.currentLane
      if (typeof domain.currentDigest === 'string') body.currentDigest = domain.currentDigest
      if (typeof domain.currentNotesHash === 'string') {
        body.currentNotesHash = domain.currentNotesHash
      }
      return c.json(body, domain.httpStatus as 400 | 404 | 409 | 422 | 500)
    }
    return errorHandler(err, c)
  })
}

/**
 * Wrap one group the way root used to mount it: under /task/api, with root's
 * authContext restored and the same error mapping. Root's CORS needs no copy —
 * it decorates the response this returns.
 */
async function buildGroupShell(group: RouteGroup): Promise<OpenAPIHono<AppContext>> {
  const shell = new OpenAPIHono<AppContext>()
  shell.use('*', async (c, next) => {
    const auth = forwardedAuth.get(c.req.raw)
    if (!auth) {
      logger.error('[Group shell] request reached a group without root auth', { group })
      return c.json({ error: 'Auth context not available' }, 500)
    }
    c.set('authContext', auth)
    return next()
  })
  shell.route('/task/api', await ROUTE_GROUPS[group]())
  installErrorHandlers(shell)
  return shell
}

/**
 * Every group merged onto one app, the way they were all mounted before they
 * went lazy, for the spec alone. Building it loads every group, which is fine for
 * a route nothing hits on the request path.
 */
async function buildSpecApp(): Promise<OpenAPIHono<AppContext>> {
  const spec = new OpenAPIHono<AppContext>()
  for (const group of Object.keys(ROUTE_GROUPS) as RouteGroup[]) {
    spec.route('/task/api', await ROUTE_GROUPS[group]())
  }

  // Every documented error response is narrowed to the codes ITS route+status can
  // emit, so nothing references the catch-all any more. Register it explicitly:
  // a generated client still needs the full `DomainErrorCode` enum and a base type
  // for statuses no route declares (429 RATE_LIMITED from the throttle, 500).
  const { DomainErrorSchema } = await import('./schemas-errors')
  spec.openAPIRegistry.register('DomainError', DomainErrorSchema)

  spec.doc(
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
        { name: 'Admin', description: 'Admin operations (requires admin access)' },
        {
          name: 'Theme editor',
          description: 'Read and commit theme tokens for hadoku.me/task/editor (service tier+)'
        }
      ]
    })
  )
  return spec
}

/**
 * Create the Task API Hono app.
 * Returns a Hono instance suitable for use as a Cloudflare Worker default export.
 */
export function createTaskHandler(): OpenAPIHono<AppContext> {
  const app = new OpenAPIHono<AppContext>()

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

  // 2. Authentication Middleware — trusts the edge-stamped tier (centralized
  // auth channel) instead of resolving keys in-worker. Drop-in for
  // createHadokuAuth: same authContext + extend. Direct *.workers.dev hits
  // degrade to public; the throttle middleware + route guards handle the rest.
  // (edge stamps X-Edge-Auth + X-Hadoku-Tier on /task/api/* via handleApiRoute.)
  app.use(
    '*',
    createEdgeAuth<TaskAuthExtension>({
      extend: base => ({
        // sessionId is used as KV key prefix (e.g., tasks:{sessionId}:{boardId})
        // Uses credential or falls back to default for public users
        sessionId: base.credential || DEFAULT_SESSION_ID,
        // key alias for backward compat (used by throttle middleware)
        key: base.credential ?? undefined
      })
    })
  )

  // 2b. Identity scoping — key storage by the STABLE userId, not the raw credential.
  //
  // edge-router injects X-User-Id on /task/api/*: the registry-derived UUID that
  // stays constant when a user's auth key is rotated. Historically `sessionId`
  // (the storage key prefix) WAS the raw credential, so rotating a key orphaned
  // every board/task/stat. Scoping by userId is what makes rotation data-safe:
  // a rotation only re-points which key resolves to the userId; data never moves.
  //
  // The previous raw-credential namespace is preserved as `legacyId` so the
  // storage layer can dual-read it and copy-forward on a hit (read-repair) —
  // pre-migration data is therefore never lost, even if a backfill missed it or
  // raced a concurrent write.
  //
  // Runs as its own middleware because createEdgeAuth's `extend` only sees the
  // auth base (credential), not request headers. Callers that bypass the edge
  // (direct *.workers.dev) get no X-User-Id and keep the legacy raw-key scoping.
  app.use('*', async (c, next) => {
    const auth = c.get('authContext')
    if (auth) {
      const userId = c.req.header('X-User-Id')
      if (userId) {
        auth.userId = userId
        // Only record a legacy namespace when there was a real credential to
        // fall back to (public callers scope to DEFAULT_SESSION_ID, not a key).
        if (auth.sessionId && auth.sessionId !== DEFAULT_SESSION_ID) {
          auth.legacyId = auth.sessionId
        }
        auth.sessionId = userId
      }
    }
    return next()
  })

  // 3. Throttle Middleware - Rate limiting per sessionId
  app.use('*', async (c, next) => {
    const auth = c.get('authContext')

    if (!auth) {
      logger.error('[Throttle Middleware] authContext is undefined!')
      return c.json({ error: 'Auth context not available' }, 500)
    }

    const sessionId = auth.sessionId || 'public'
    const userType = auth.userType

    // Skip throttling for:
    // - Health check endpoint (monitoring)
    // - Trusted HUMAN tiers (admin/friend) — no rate limiting
    // - Validate-key endpoint - needed for initial connection, users don't have session yet
    // - Session handshake - needed for session establishment
    // This significantly reduces KV operations and prevents unnecessary usage
    //
    // `service` (automated agents like TenHands) IS throttled, but at its own
    // generous 600/min ceiling (throttle.ts) — high enough that normal operation
    // can't approach it, so a runaway bot is still bounded without capping a human.
    //
    // THROTTLED_TIERS is deliberately a SET, not a rank check: it is a policy
    // ("throttle anonymous and machine callers, exempt humans"), not an access
    // gate. It is not monotonic in tier — `service` outranks `friend` yet is the
    // throttled one — so tierAtLeast would be the wrong tool here.
    const skipThrottlePaths = [
      '/task/api/health',
      '/task/api/validate-key',
      '/task/api/session/handshake'
    ]
    if (skipThrottlePaths.includes(c.req.path) || !isThrottledTier(userType)) {
      return next()
    }

    // Check throttle (public + service tiers)
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
          logger.warn('[Throttle] Failed to record incident (KV error)', {
            error: kvError instanceof Error ? kvError.message : String(kvError)
          })
        }

        logError('THROTTLE', c.req.path, `Rate limit exceeded: ${throttleResult.reason}`)

        return c.json(
          {
            error: 'Rate limit exceeded',
            // Machine-readable code so an agent branches on this, not the string.
            code: 'RATE_LIMITED',
            message: throttleResult.reason,
            retryAfter: 60 // seconds
          },
          429
        )
      }
    } catch (error) {
      // If KV operations fail (e.g., rate limit exceeded), log and continue
      // This prevents KV issues from breaking the API
      logger.warn('[Throttle] KV operation failed, skipping throttle check', {
        error: error instanceof Error ? error.message : String(error)
      })
      // Continue without throttling rather than failing the request
    }

    return next()
  })

  // ============================================================================
  // Route Registration
  // ============================================================================
  // Root holds no route group. Each manifest row is a stub that loads its group
  // on first use and forwards the request to it; a group's schemas are built
  // only when a request needs them. Stubs register in manifest order, which is
  // the order the groups used to be mounted, so match precedence is unchanged.

  // Answered here, not by the misc group, so a cold /health loads no group.
  app.get('/task/api/health', c => c.json(healthBody(), 200))

  // MCP endpoint (stateless Streamable-HTTP). Auth/scoping come from the shared
  // authContext (X-User-Key); it runs on root's Context, so it needs no shell.
  app.post('/task/api/mcp', async c => (await import('./mcp/handler')).handleMcp(c))
  app.get('/task/api/mcp', c => c.text('Method Not Allowed', 405))

  // One shell per group per handler, built once. A failed load is dropped so the
  // next request retries it instead of replaying the rejection forever.
  const shells = new Map<RouteGroup, Promise<OpenAPIHono<AppContext>>>()
  const loadShell = (group: RouteGroup) => {
    let shell = shells.get(group)
    if (!shell) {
      shell = buildGroupShell(group)
      shells.set(group, shell)
      shell.catch(() => shells.delete(group))
    }
    return shell
  }

  for (const [method, path, group] of ROUTE_MANIFEST) {
    app.on(method, path, async c => {
      forwardedAuth.set(c.req.raw, c.get('authContext'))
      const shell = await loadShell(group)
      return shell.fetch(c.req.raw, c.env, executionCtxOf(c))
    })
  }

  // ============================================================================
  // OpenAPI Spec Endpoint
  // ============================================================================

  let specApp: Promise<OpenAPIHono<AppContext>> | undefined
  app.get('/task/api/openapi.json', async c => {
    specApp ??= buildSpecApp().catch(err => {
      specApp = undefined
      throw err
    })
    return (await specApp).fetch(c.req.raw, c.env)
  })

  installErrorHandlers(app)

  return app
}
