/**
 * The schemas every route group can reach for: the error bodies, /health and
 * /validate-key. Kept to a handful of nodes on purpose — a group that only
 * needs an error schema (shares, theme-editor, misc) must not evaluate the
 * task/board entities in schemas.ts to get one. See route-groups.ts.
 */
import { z } from '@hono/zod-openapi'
import { SimpleErrorResponseSchema, TaskApiHealthResponseSchema } from '@wolffm/worker-utils'

/**
 * The error body this API actually returns, which is not what
 * `ErrorResponseSchema` (worker-utils' SimpleErrorResponse) describes.
 *
 * Two shapes reach the wire and neither matched the declared `{error, message?}`:
 *
 *   - handlers return `{ error, code? }`, where `code` is the machine-readable
 *     discriminator agents branch on — BOARD_NOT_FOUND, LANE_NOT_EDITABLE,
 *     DIGEST_MISMATCH. It was entirely undocumented despite being the field a
 *     generated client most needs.
 *   - worker-utils' `badRequest()` returns `{ error, details?, timestamp }`.
 *
 * This is the union of both, so it describes every error response honestly.
 * `message` is kept optional for anything still emitting the older shape.
 */
export const ApiErrorSchema = z
  .object({
    error: z.string().openapi({ example: 'Board not found' }),
    /** Machine-readable discriminator. Absent on generic failures. */
    code: z.string().optional().openapi({ example: 'BOARD_NOT_FOUND' }),
    message: z.string().optional(),
    details: z.unknown().optional(),
    timestamp: z.string().optional().openapi({ example: '2026-01-15T10:30:00.000Z' })
  })
  .openapi('ApiError')

export const ErrorResponseSchema = SimpleErrorResponseSchema
export const HealthResponseSchema = TaskApiHealthResponseSchema

// ============================================================================
// Misc Endpoint Schemas
// ============================================================================

// POST /validate-key
export const ValidateKeyResponseSchema = z
  .object({
    valid: z.boolean().openapi({ example: true }),
    userType: z.string().openapi({ example: 'admin' }),
    // Stable per-user UUID that edge-router resolves from the key registry and
    // injects as X-User-Id. It survives key rotation, so it is the identity that
    // storage keys off (replacing the raw credential). Absent on direct
    // *.workers.dev hits, which bypass the edge and so get no injection.
    // Safe to return: it is the caller's own identifier, never key material.
    userId: z.string().optional().openapi({ example: '3f2a9c7e-1b4d-4c8a-9e2f-7a6b5c4d3e2f' })
  })
  .openapi('ValidateKeyResponse')
