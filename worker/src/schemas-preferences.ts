/**
 * Zod schemas for the stored preferences blob and /preferences.
 */
import { z } from '@hono/zod-openapi'

/**
 * A stored preferences blob, as GET /preferences and the handshake return it.
 *
 * `.passthrough()` is not decoration — it is what the write side already
 * promises. UpdatePreferencesInputSchema is passthrough on purpose ("Allow
 * additional fields like notifications, language, etc."), PUT /preferences
 * spreads that validated body straight into the stored object, and GET hands
 * back whatever KV holds. So the API invites arbitrary preference keys, keeps
 * them, and returns them.
 *
 * Describing the RESPONSE as a closed object therefore contradicted the request
 * it answers: a client generated from this spec would drop — or reject — exactly
 * the fields the write endpoint told it to send. The named keys below are the
 * ones with defined meaning; anything else round-trips untouched.
 */
export const UserPreferencesSchema = z
  .object({
    theme: z.string().optional().openapi({ example: 'dark' }),
    buttons: z
      .record(z.string(), z.boolean())
      .optional()
      .openapi({ example: { complete: true, delete: false } }),
    experimentalFlags: z
      .record(z.string(), z.boolean())
      .optional()
      .openapi({ example: { newLayout: true } }),
    layout: z.record(z.string(), z.unknown()).optional(),
    /** Set server-side on every write; never accepted from the caller. */
    lastUpdated: z.string().optional().openapi({ example: '2024-01-15T10:30:00.000Z' })
  })
  .passthrough()
  .openapi('UserPreferences')

// ============================================================================
// Preferences Endpoint Schemas
// ============================================================================

// GET /preferences
export const GetPreferencesResponseSchema = UserPreferencesSchema

// PUT /preferences
export const UpdatePreferencesInputSchema = z
  .object({
    theme: z.string().optional(),
    buttons: z.record(z.string(), z.boolean()).optional(),
    experimentalFlags: z.record(z.string(), z.boolean()).optional(),
    layout: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough() // Allow additional fields like notifications, language, etc.
  .openapi('UpdatePreferencesInput')

export const UpdatePreferencesResponseSchema = z
  .object({
    ok: z.literal(true),
    message: z.string().openapi({ example: 'Preferences saved' }),
    preferences: UserPreferencesSchema
  })
  .openapi('UpdatePreferencesResponse')
