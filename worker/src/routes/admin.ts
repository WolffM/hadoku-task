/**
 * Admin Routes
 *
 * Handles administrative endpoints for monitoring and management
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { maskSessionId, tierAtLeast } from '@wolffm/worker-utils'
import { logRequest } from '../logger'
import {
  getThrottleState,
  getIncidents,
  isSessionBlacklisted,
  unblacklistSession,
  resetThrottleState
} from '../throttle'
import type { AppContext } from '../types'
import { ErrorResponseSchema } from '../schemas-common'
import {
  GetOrphansResponseSchema,
  GetThrottleStatusResponseSchema,
  UnblacklistResponseSchema
} from '../schemas-admin'
import { DEFAULT_SESSION_ID } from '../constants'

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

  app.openapi(getThrottleStatusRoute, async c => {
    const auth = c.get('authContext')
    if (!tierAtLeast(auth, 'admin')) {
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
  })

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

  app.openapi(unblacklistRoute, async c => {
    const auth = c.get('authContext')
    if (!tierAtLeast(auth, 'admin')) {
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
  })

  // Data integrity (#109): rows no route can reach. A task with no board is
  // invisible to its owner (every read goes through a board) and still holds a
  // `source` uniqueness slot; a row owned by the 'public' sentinel belongs to no
  // account, so no account erase removes it. Both should always be zero — the
  // writes delete a board with its tasks in one batch, and storage-access.ts
  // refuses callers without an identity — so nonzero means a path regressed.
  const orphansRoute = createRoute({
    method: 'get',
    path: '/admin/orphans',
    tags: ['Admin'],
    summary: 'Count rows no route can reach',
    description:
      "Tasks whose board no longer exists, and rows owned by the 'public' sentinel. Both should be zero. Requires admin access.",
    responses: {
      200: {
        description: 'Integrity counts',
        content: { 'application/json': { schema: GetOrphansResponseSchema } }
      },
      403: {
        description: 'Admin access required',
        content: { 'application/json': { schema: ErrorResponseSchema } }
      }
    }
  })

  app.openapi(orphansRoute, async c => {
    const auth = c.get('authContext')
    if (!tierAtLeast(auth, 'admin')) {
      return c.json({ error: 'Admin access required' }, 403)
    }
    logRequest('GET', '/task/api/admin/orphans', { userType: auth.userType })
    const db = c.env.DB as unknown as {
      prepare(sql: string): {
        bind(...a: unknown[]): {
          all<T>(): Promise<{ results: T[] }>
          first<T>(): Promise<T | null>
        }
      }
    }
    const ORPHANS = `FROM tasks t LEFT JOIN boards b ON b.user_id = t.user_id AND b.id = t.board_id
                     WHERE b.id IS NULL`
    const [count, sample, sentinel] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS n ${ORPHANS}`).bind().first<{ n: number }>(),
      db
        .prepare(
          `SELECT t.user_id AS userId, t.board_id AS boardId, t.id AS taskId, t.created_at AS createdAt
             ${ORPHANS} ORDER BY t.created_at LIMIT 50`
        )
        .bind()
        .all<{ userId: string; boardId: string; taskId: string; createdAt: string }>(),
      db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM boards WHERE user_id = ?1)
                + (SELECT COUNT(*) FROM board_meta WHERE user_id = ?1)
                + (SELECT COUNT(*) FROM board_prefs WHERE user_id = ?1)
                + (SELECT COUNT(*) FROM tasks WHERE user_id = ?1) AS n`
        )
        .bind(DEFAULT_SESSION_ID)
        .first<{ n: number }>()
    ])
    return c.json(
      {
        orphanTasks: count?.n ?? 0,
        sample: sample.results,
        sentinelRows: sentinel?.n ?? 0
      },
      200
    )
  })

  return app
}
