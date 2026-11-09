/**
 * Tracker-board schemas. Split out like the other schemas-* modules so only the
 * trackers route group evaluates them on a cold isolate.
 */
import { z } from '@hono/zod-openapi'

export const TRACKER_KINDS = ['counter', 'value'] as const
export const TRACKER_ENTRY_SOURCES = ['web', 'api', 'button'] as const

/** Upper bound on a tracker or entry number. Keeps REAL math well inside exact-integer range. */
export const MAX_TRACKER_MAGNITUDE = 1e9

const magnitude = z.number().finite().min(-MAX_TRACKER_MAGNITUDE).max(MAX_TRACKER_MAGNITUDE)

export const TrackerSchema = z
  .object({
    id: z.string().openapi({ example: '01JC0Z8Q5W3V6H1Y2K4M7N9P0R' }),
    name: z.string().openapi({ example: 'Pushups' }),
    kind: z.enum(TRACKER_KINDS).openapi({
      description:
        '`counter`: entries add a delta to the running count. `value`: each entry records the current value (e.g. a weight).'
    }),
    unit: z.string().nullable().openapi({ example: 'reps' }),
    value: z.number().openapi({ description: 'The running count, or the latest logged value.' }),
    position: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .openapi('Tracker')

export const TrackerEntrySchema = z
  .object({
    id: z.string(),
    trackerId: z.string(),
    delta: z
      .number()
      .nullable()
      .openapi({ description: 'The change, on a counter. Null on a value entry.' }),
    value: z.number().openapi({ description: "The tracker's value once this entry applied." }),
    source: z.enum(TRACKER_ENTRY_SOURCES),
    actorId: z.string().nullable(),
    note: z.string().nullable(),
    at: z.string().openapi({ example: '2026-11-09T14:03:00.000Z' })
  })
  .openapi('TrackerEntry')

export const ListTrackersQuerySchema = z.object({
  since: z.string().datetime().optional().openapi({
    description:
      'Return entries at or after this instant. Defaults to 8 days ago, enough for a "last 7 days" total in any timezone.',
    example: '2026-11-01T00:00:00.000Z'
  })
})

export const ListTrackersResponseSchema = z
  .object({
    board: z.string(),
    canWrite: z.boolean(),
    trackers: z.array(TrackerSchema),
    entries: z.array(TrackerEntrySchema).openapi({
      description: 'Entries since `since`, newest first, capped at 500.'
    })
  })
  .openapi('ListTrackersResponse')

export const CreateTrackerInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100).openapi({ example: 'Pushups' }),
    kind: z.enum(TRACKER_KINDS).default('counter'),
    unit: z.string().trim().max(20).nullable().optional().openapi({ example: 'reps' })
  })
  .openapi('CreateTrackerInput')

export const UpdateTrackerInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    unit: z.string().trim().max(20).nullable().optional(),
    position: z.number().int().min(0).optional()
  })
  .openapi('UpdateTrackerInput')

export const TrackerResponseSchema = z
  .object({ ok: z.literal(true), tracker: TrackerSchema })
  .openapi('TrackerResponse')

export const DeleteTrackerResponseSchema = z
  .object({ ok: z.literal(true), deleted: z.string() })
  .openapi('DeleteTrackerResponse')

export const CreateTrackerEntryInputSchema = z
  .object({
    delta: magnitude.optional().openapi({
      description: 'Counter only: add this to the count (negative to subtract). Defaults to 1.',
      example: 1
    }),
    value: magnitude.optional().openapi({
      description:
        'Set the value outright. Required on a `value` tracker; on a counter it resets the count and logs the difference.',
      example: 81.4
    }),
    note: z.string().trim().max(500).optional(),
    source: z.enum(TRACKER_ENTRY_SOURCES).default('web')
  })
  .refine(b => b.delta === undefined || b.value === undefined, {
    message: 'Send `delta` or `value`, not both'
  })
  .openapi('CreateTrackerEntryInput')

export const TrackerEntryResponseSchema = z
  .object({ ok: z.literal(true), tracker: TrackerSchema, entry: TrackerEntrySchema })
  .openapi('TrackerEntryResponse')

export const DeleteTrackerEntryResponseSchema = z
  .object({ ok: z.literal(true), tracker: TrackerSchema })
  .openapi('DeleteTrackerEntryResponse')
