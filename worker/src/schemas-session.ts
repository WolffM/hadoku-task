/**
 * Zod schemas for POST /session/handshake.
 */
import { z } from '@hono/zod-openapi'
import { UserPreferencesSchema } from './schemas-preferences'

// ============================================================================
// Session Endpoint Schemas
// ============================================================================

// POST /session/handshake
export const SessionHandshakeInputSchema = z
  .object({
    newSessionId: z.string().min(1).openapi({ example: 'sess_abc123xyz' }),
    oldSessionId: z.string().nullable().optional().openapi({ example: 'sess_old456def' })
  })
  .openapi('SessionHandshakeInput')

/**
 * Mirrors `HandshakeResponse` in worker/src/session.ts — the object
 * handleSessionHandshake actually returns.
 *
 * It previously declared `success: true` and `migrated`, which the handler has
 * never sent, and omitted `userType`, which it always sends AND which the
 * frontend reads to detect an expired session (see performSessionHandshake in
 * src/api/session.ts). Response schemas are documentation here — @hono/zod-openapi
 * validates requests, not responses — so nothing failed at runtime; the drift
 * showed up only in the generated spec that TenHands codegens against.
 *
 * `preferences` is required, not optional: the handler fills DEFAULT_PREFERENCES
 * when nothing resolves, so the field is always present.
 */
export const SessionHandshakeResponseSchema = z
  .object({
    sessionId: z.string().openapi({ example: 'sess_abc123xyz' }),
    preferences: UserPreferencesSchema,
    isNewSession: z.boolean().openapi({ example: true }),
    /** Only set when preferences were recovered from a prior session. */
    migratedFrom: z.string().optional().openapi({ example: 'sess_old456def' }),
    /**
     * Re-validated server-side from the auth key, so it can disagree with what
     * the client believed — that disagreement IS the expiry signal.
     */
    userType: z.enum(['admin', 'friend', 'public']).openapi({ example: 'friend' })
  })
  .openapi('SessionHandshakeResponse')
