/**
 * Zod schemas for the admin endpoints (throttle state, unblacklist).
 */
import { z } from '@hono/zod-openapi'

// ============================================================================
// Admin Endpoint Schemas
// ============================================================================

// GET /admin/throttle/:sessionId
/**
 * Mirrors `ThrottleState` in worker/src/throttle.ts, which is what
 * GET /admin/throttle/{sessionId} serialises verbatim.
 *
 * The counter is `count`, not `requestCount` — the documented name never
 * existed on the wire, so a generated client read undefined for the one number
 * the endpoint is about. `lastViolation` was missing entirely.
 */
export const ThrottleStateSchema = z
  .object({
    count: z.number().openapi({ example: 15 }),
    windowStart: z.number().openapi({ example: 1704067200000, description: 'Epoch ms.' }),
    violations: z.number().openapi({ example: 0 }),
    lastViolation: z.number().optional().openapi({ example: 1704067205000 })
  })
  .openapi('ThrottleState')

export const IncidentSchema = z
  .object({
    timestamp: z.string().openapi({ example: '2024-01-15T10:30:00.000Z' }),
    type: z.string().openapi({ example: 'throttle_violation' }),
    sessionId: z.string().openapi({ example: 'sess_***abc' }),
    authKey: z.string().optional().openapi({ example: 'key_***xyz' }),
    userType: z.string().openapi({ example: 'public' }),
    details: z.record(z.string(), z.unknown()).optional()
  })
  .openapi('Incident')

export const GetThrottleStatusResponseSchema = z
  .object({
    sessionId: z.string().openapi({ example: 'sess_***abc' }),
    throttleState: ThrottleStateSchema.nullable(),
    blacklisted: z.boolean().openapi({ example: false }),
    incidents: z.array(IncidentSchema),
    incidentCount: z.number().openapi({ example: 0 })
  })
  .openapi('GetThrottleStatusResponse')

// POST /admin/unblacklist/:sessionId
export const UnblacklistResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string().openapi({ example: 'Session sess_***abc unblacklisted' })
  })
  .openapi('UnblacklistResponse')

// GET /admin/orphans
export const OrphanTaskSchema = z
  .object({
    userId: z.string().openapi({ example: 'e3592686-8c23-4bbc-b2f3-85ab02dc38d0' }),
    boardId: z.string().openapi({ example: 'tenhands' }),
    taskId: z.string().openapi({ example: '01KCG33G9W9GDE8N09K9QSC0MT' }),
    createdAt: z.string().openapi({ example: '2026-07-25T16:42:46.537Z' })
  })
  .openapi('OrphanTask')

export const GetOrphansResponseSchema = z
  .object({
    orphanTasks: z.number().openapi({
      example: 0,
      description: 'Tasks whose board_id has no boards row for the same owner. No route lists them.'
    }),
    sample: z.array(OrphanTaskSchema).openapi({ description: 'Up to 50, oldest first.' }),
    sentinelRows: z.number().openapi({
      example: 0,
      description:
        "Board, board_meta, board_prefs and task rows owned by the 'public' sentinel, which no account owns or can erase (#107)."
    })
  })
  .openapi('GetOrphansResponse')
