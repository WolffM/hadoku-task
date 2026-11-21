/**
 * Exercise / sequence schemas: the shared library, board sequence widgets, and
 * the run log. Split out like the other schemas-* modules so only the library
 * and sequences route groups evaluate them on a cold isolate.
 */
import { z } from '@hono/zod-openapi'

export const NODE_MODES = ['timed', 'manual'] as const
export const RUN_STATUSES = ['active', 'completed', 'stopped'] as const
export const NODE_OUTCOMES = ['completed', 'skipped', 'rewound', 'stopped'] as const

/** A node's timer bounds: 1 second to 2 hours. */
export const MAX_NODE_SECONDS = 7200
/** Longest sequence the builder takes. */
export const MAX_SEQUENCE_NODES = 100
/** A node play can't claim more than a day on the clock. */
const MAX_ACTIVE_MS = 24 * 60 * 60 * 1000

/** A cdn.hadoku.me image object key: the content's sha256 and an image extension. */
export const IMAGE_KEY_RE = /^[0-9a-f]{64}\.(png|jpg|gif|webp|avif)$/

const name = z.string().trim().min(1).max(100)
const description = z.string().trim().max(2000)

// ------------------------------------------------------------------ exercises

export const ExerciseSchema = z
  .object({
    id: z.string().openapi({ example: '01JD3K6Q2C4V8H1Y2K4M7N9P0R' }),
    version: z.number().int().openapi({ description: 'This version. Versions start at 1.' }),
    latestVersion: z.number().int().openapi({
      description: 'The newest version. Above `version` when this is a pinned older one.'
    }),
    name: z.string().openapi({ example: 'Plank' }),
    description: z.string().nullable(),
    imageKey: z.string().nullable(),
    imageUrl: z.string().nullable().openapi({ example: 'https://cdn.hadoku.me/3f…a1.webp' }),
    ownerId: z.string(),
    mine: z.boolean().openapi({ description: 'The caller made it.' }),
    canEdit: z.boolean().openapi({ description: 'The caller made it, or is an admin.' }),
    deleted: z.boolean().openapi({
      description: 'Deleted from the library. Pinned versions keep resolving.'
    }),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .openapi('Exercise')

export const LibraryQuerySchema = z.object({
  q: z.string().trim().max(100).optional().openapi({ description: 'Name contains, any case.' }),
  mine: z.enum(['1', '0']).optional().openapi({ description: '`1`: only what the caller made.' })
})

export const VersionQuerySchema = z.object({
  version: z.coerce.number().int().min(1).optional().openapi({
    description: 'A specific version. Defaults to the latest.'
  })
})

export const ExerciseInputSchema = z
  .object({
    name,
    description: description.nullable().optional(),
    imageKey: z
      .string()
      .regex(IMAGE_KEY_RE)
      .nullable()
      .optional()
      .openapi({ description: 'From POST /library/images. Null for no picture.' })
  })
  .openapi('ExerciseInput')

export const ExerciseResponseSchema = z
  .object({ ok: z.literal(true), exercise: ExerciseSchema })
  .openapi('ExerciseResponse')

export const ListExercisesResponseSchema = z
  .object({ exercises: z.array(ExerciseSchema) })
  .openapi('ListExercisesResponse')

export const ImageUploadResponseSchema = z
  .object({ ok: z.literal(true), imageKey: z.string(), imageUrl: z.string() })
  .openapi('ImageUploadResponse')

// ------------------------------------------------------------------ sequences

export const SequenceNodeInputSchema = z
  .object({
    exerciseId: z.string().min(1),
    exerciseVersion: z.number().int().min(1).optional().openapi({
      description: 'Pin this version. Defaults to the exercise’s latest.'
    }),
    mode: z.enum(NODE_MODES).openapi({
      description:
        '`timed`: the node ends when its timer runs out. `manual`: it waits for the player to press next.'
    }),
    seconds: z.number().int().min(1).max(MAX_NODE_SECONDS).nullable().optional().openapi({
      description: 'Required on a timed node; ignored on a manual one.'
    })
  })
  .refine(n => n.mode === 'manual' || typeof n.seconds === 'number', {
    message: 'A timed node needs `seconds`'
  })
  .openapi('SequenceNodeInput')

export const SequenceNodeSchema = z
  .object({
    position: z.number().int(),
    mode: z.enum(NODE_MODES),
    seconds: z.number().int().nullable(),
    exercise: ExerciseSchema.openapi({ description: 'The pinned exercise version.' })
  })
  .openapi('SequenceNode')

const sequenceFields = {
  id: z.string(),
  version: z.number().int(),
  latestVersion: z.number().int(),
  name: z.string().openapi({ example: 'Morning mobility' }),
  description: z.string().nullable(),
  ownerId: z.string(),
  mine: z.boolean(),
  canEdit: z.boolean(),
  deleted: z.boolean(),
  nodeCount: z.number().int(),
  timedSeconds: z.number().int().openapi({
    description: 'Sum of the timed nodes, countdowns excluded.'
  }),
  manualCount: z.number().int().openapi({ description: 'Nodes that wait for "next".' }),
  createdAt: z.string(),
  updatedAt: z.string()
}

export const SequenceSummarySchema = z.object(sequenceFields).openapi('SequenceSummary')

export const SequenceSchema = z
  .object({ ...sequenceFields, nodes: z.array(SequenceNodeSchema) })
  .openapi('Sequence')

export const SequenceInputSchema = z
  .object({
    name,
    description: description.nullable().optional(),
    nodes: z.array(SequenceNodeInputSchema).min(1).max(MAX_SEQUENCE_NODES)
  })
  .openapi('SequenceInput')

export const SequenceResponseSchema = z
  .object({ ok: z.literal(true), sequence: SequenceSchema })
  .openapi('SequenceResponse')

export const ListSequencesResponseSchema = z
  .object({ sequences: z.array(SequenceSummarySchema) })
  .openapi('ListSequencesResponse')

export const DeletedResponseSchema = z
  .object({ ok: z.literal(true), deleted: z.string() })
  .openapi('LibraryDeletedResponse')

// ------------------------------------------------------------------ runs

export const RunNodeSchema = z
  .object({
    seq: z.number().int(),
    position: z.number().int(),
    exerciseId: z.string(),
    exerciseVersion: z.number().int(),
    outcome: z.enum(NODE_OUTCOMES),
    activeMs: z.number().int(),
    startedAt: z.string(),
    endedAt: z.string()
  })
  .openapi('SequenceRunNode')

export const RunSchema = z
  .object({
    id: z.string(),
    runnerId: z.string(),
    mine: z.boolean(),
    sequenceId: z.string(),
    sequenceVersion: z.number().int(),
    nodeCount: z.number().int(),
    widgetId: z.string().nullable(),
    status: z.enum(RUN_STATUSES),
    complete: z.boolean().openapi({
      description: 'Every node of the sequence has at least one completed play.'
    }),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    nodes: z.array(RunNodeSchema).openapi({ description: 'Every node play, in order.' })
  })
  .openapi('SequenceRun')

export const StartRunInputSchema = z
  .object({
    sequenceId: z.string().min(1),
    version: z.number().int().min(1),
    board: z.string().min(1).optional().openapi({
      description: 'Started from a board widget: the board reference…'
    }),
    widgetId: z.string().min(1).optional().openapi({ description: '…and the widget.' })
  })
  .refine(b => (b.board === undefined) === (b.widgetId === undefined), {
    message: 'Send `board` and `widgetId` together'
  })
  .openapi('StartRunInput')

export const RunNodeInputSchema = z
  .object({
    position: z.number().int().min(0),
    outcome: z.enum(NODE_OUTCOMES),
    activeMs: z.number().int().min(0).max(MAX_ACTIVE_MS),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime()
  })
  .openapi('RunNodeInput')

export const FinishRunInputSchema = z
  .object({ status: z.enum(['completed', 'stopped']) })
  .openapi('FinishRunInput')

export const RunResponseSchema = z
  .object({ ok: z.literal(true), run: RunSchema })
  .openapi('SequenceRunResponse')

export const ListRunsQuerySchema = z.object({
  sequenceId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
})

export const ListRunsResponseSchema = z
  .object({ runs: z.array(RunSchema) })
  .openapi('ListSequenceRunsResponse')

// ------------------------------------------------------------------ board widgets

export const SequenceWidgetSchema = z
  .object({
    id: z.string(),
    position: z.number().int(),
    sequence: SequenceSchema.openapi({ description: 'The pinned sequence version, resolved.' }),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .openapi('SequenceWidget')

export const ListSequenceWidgetsResponseSchema = z
  .object({
    board: z.string(),
    canWrite: z.boolean(),
    widgets: z.array(SequenceWidgetSchema),
    runs: z.array(RunSchema).openapi({
      description: 'Runs started from these widgets in the last 30 days, newest first.'
    })
  })
  .openapi('ListSequenceWidgetsResponse')

export const AddSequenceWidgetInputSchema = z
  .object({
    sequenceId: z.string().min(1),
    version: z.number().int().min(1).optional().openapi({ description: 'Defaults to the latest.' })
  })
  .openapi('AddSequenceWidgetInput')

export const UpdateSequenceWidgetInputSchema = z
  .object({
    version: z.number().int().min(1).optional().openapi({
      description: 'Re-pin to this version of the same sequence (usually its latest).'
    }),
    position: z.number().int().min(0).optional()
  })
  .openapi('UpdateSequenceWidgetInput')

export const SequenceWidgetResponseSchema = z
  .object({ ok: z.literal(true), widget: SequenceWidgetSchema })
  .openapi('SequenceWidgetResponse')
