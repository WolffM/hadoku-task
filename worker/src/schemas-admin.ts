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
