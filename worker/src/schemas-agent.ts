/**
 * Zod schemas for the agent / automation / sharing endpoints (§4–§7).
 *
 * Same source-of-truth pattern as schemas.ts: these both VALIDATE the request and
 * GENERATE the OpenAPI spec (`/task/api/openapi.json`), so a Python consumer like
 * TenHands can codegen a client and catch drift at build time, not runtime.
 */
import { z } from '@hono/zod-openapi'
import { TaskSchema } from './schemas'

// ============================================================================
// Shared
// ============================================================================

/** A domain error: `error` message + a machine-readable `code`, plus optional
 * actionable fields (holder/expiry on CLAIM_HELD, currentVersion, currentLane). */
export const DomainErrorSchema = z
  .object({
    error: z.string().openapi({ example: 'Task is claimed by agent-x until …' }),
    code: z.string().openapi({ example: 'CLAIM_HELD' }),
    holder: z.string().optional().openapi({ example: 'agent-x' }),
    expiresAt: z.string().optional().openapi({ example: '2026-07-25T00:38:20.747Z' }),
    currentVersion: z.number().optional(),
    currentLane: z.string().nullable().optional(),
    retryAfter: z.number().optional().openapi({ example: 60 })
  })
  .openapi('DomainError')

/** One lane in an automation board's fixed vocabulary (§5.1). Extra provider keys
 * are preserved verbatim, hence `passthrough`. */
export const LaneSchema = z
  .object({
    tag: z.string().openapi({ example: 'needs-plan' }),
    label: z.string().openapi({ example: 'Needs Plan' }),
    order: z.number().openapi({ example: 1 }),
    editableBy: z.enum(['user', 'agent']).openapi({ example: 'user' })
  })
  .passthrough()
  .openapi('Lane')

/** Lane shape for the activation REQUEST body: deliberately permissive so the
 * server's structural validator (validateLaneSet) stays the single authority —
 * it returns a specific 422 LANE_SET_INVALID rather than a generic zod 400. */
export const LaneInputSchema = z
  .object({
    tag: z.string(),
    label: z.string(),
    order: z.number(),
    editableBy: z.string().openapi({ description: '"user" or "agent".' })
  })
  .passthrough()
  .openapi('LaneInput')

const boardRefParam = z.object({
  ref: z.string().openapi({ param: { name: 'ref', in: 'path' }, example: 'main' })
})

// ============================================================================
// Sharing (§7)
// ============================================================================

export const GrantShareInputSchema = z
  .object({
    key: z.string().optional().openapi({ example: 'friend-…', description: 'Grantee access key (resolved to a userId).' }),
    userId: z.string().optional().openapi({ description: 'Grantee userId, if you already have it.' }),
    level: z.enum(['readonly', 'contributor']).openapi({ example: 'contributor' })
  })
  .openapi('GrantShareInput')

export const GrantShareResponseSchema = z
  .object({
    ok: z.boolean(),
    granteeUserId: z.string(),
    granteeName: z.string().optional(),
    level: z.enum(['readonly', 'contributor'])
  })
  .openapi('GrantShareResponse')

export const ShareRowSchema = z
  .object({
    granteeUserId: z.string(),
    level: z.enum(['readonly', 'contributor']),
    createdAt: z.string()
  })
  .openapi('ShareRow')

export const ListSharesResponseSchema = z
  .object({ shares: z.array(ShareRowSchema) })
  .openapi('ListSharesResponse')

export const LeaveShareResponseSchema = z
  .object({ ok: z.boolean(), left: z.boolean() })
  .openapi('LeaveShareResponse')

export const RevokeShareResponseSchema = z
  .object({ ok: z.boolean(), removed: z.boolean() })
  .openapi('RevokeShareResponse')

export { boardRefParam }

// ============================================================================
// Automation (§5)
// ============================================================================

export const ActivateInputSchema = z
  .object({
    lanes: z.array(LaneInputSchema).min(1),
    schemaId: z.string().nullable().optional(),
    schemaVersion: z.number().nullable().optional(),
    repo: z.string().nullable().optional(),
    dryRun: z.boolean().optional().openapi({ description: 'Preview + digest only; writes nothing.' }),
    digest: z.string().optional().openapi({ description: 'The dryRun digest, echoed on commit (stale ⇒ 409 DIGEST_MISMATCH).' })
  })
  .openapi('ActivateAutomationInput')

export const ActivationMappingRowSchema = z
  .object({
    tag: z.string(),
    count: z.number(),
    lands: z.enum(['lane', 'inbox'])
  })
  .openapi('ActivationMappingRow')

export const ActivationPreviewSchema = z
  .object({
    digest: z.string(),
    lanes: z.array(LaneSchema),
    mapping: z.array(ActivationMappingRowSchema),
    toInbox: z.number(),
    collisions: z.array(z.string())
  })
  .openapi('ActivationPreview')

export const ActivateResponseSchema = z
  .object({
    ok: z.boolean(),
    dryRun: z.boolean(),
    preview: ActivationPreviewSchema,
    applied: z
      .object({
        mode: z.literal('automation'),
        laneCount: z.number(),
        tasksToInbox: z.number()
      })
      .optional()
  })
  .openapi('ActivateAutomationResponse')

export const DeactivateResponseSchema = z
  .object({
    ok: z.boolean(),
    mode: z.literal('standard'),
    restoredTags: z.array(z.string())
  })
  .openapi('DeactivateAutomationResponse')

// ============================================================================
// Agent claim protocol (§4)
// ============================================================================

export const ClaimInputSchema = z
  .object({
    board: z.string().openapi({ example: 'main' }),
    taskId: z.string(),
    agentId: z.string().optional(),
    lane: z.string().nullable().optional(),
    leaseSeconds: z.number().optional().openapi({ example: 1800 })
  })
  .openapi('ClaimInput')

export const ClaimResponseSchema = z
  .object({
    token: z.string(),
    agentId: z.string(),
    expiresAt: z.string(),
    lane: z.string().nullable()
  })
  .openapi('ClaimResponse')

export const HeartbeatInputSchema = z
  .object({
    board: z.string(),
    taskId: z.string(),
    token: z.string(),
    leaseSeconds: z.number().optional()
  })
  .openapi('HeartbeatInput')

export const HeartbeatResponseSchema = z
  .object({ ok: z.boolean(), expiresAt: z.string() })
  .openapi('HeartbeatResponse')

export const SetLaneInputSchema = z
  .object({
    board: z.string(),
    taskId: z.string(),
    token: z.string(),
    lane: z.string()
  })
  .openapi('SetLaneInput')

export const SetLaneResponseSchema = z
  .object({ ok: z.boolean(), lane: z.string() })
  .openapi('SetLaneResponse')

export const ReleaseInputSchema = z
  .object({
    board: z.string(),
    taskId: z.string(),
    token: z.string(),
    lane: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    outcome: z.string().nullable().optional(),
    ifCurrentLane: z.string().optional().openapi({ description: 'Abort with 409 LANE_CHANGED unless the task is still in this lane.' }),
    complete: z.boolean().optional().openapi({ description: 'Archive the task on release (claim-gated).' })
  })
  .openapi('ReleaseInput')

export const ReleaseResponseSchema = z
  .object({
    ok: z.boolean(),
    released: z.boolean(),
    lane: z.string().nullable(),
    completed: z.boolean().optional()
  })
  .openapi('ReleaseResponse')

export const CancelInputSchema = z
  .object({ board: z.string(), taskId: z.string() })
  .openapi('CancelInput')

export const CancelResponseSchema = z
  .object({ ok: z.boolean(), dropped: z.boolean() })
  .openapi('CancelResponse')

export const ClaimLogRowSchema = z
  .object({
    agentId: z.string(),
    claimedAt: z.string(),
    endedAt: z.string().nullable(),
    endedBy: z.string().nullable(),
    outcome: z.string().nullable()
  })
  .openapi('ClaimLogRow')

export const ClaimHistoryResponseSchema = z
  .object({ history: z.array(ClaimLogRowSchema) })
  .openapi('ClaimHistoryResponse')

export const ChangeRowSchema = z
  .object({
    id: z.string(),
    boardId: z.string(),
    tag: z.string().nullable(),
    state: z.string().openapi({ example: 'Active' }),
    updatedAt: z.string()
  })
  .openapi('ChangeRow')

export const ChangesResponseSchema = z
  .object({
    changes: z.array(ChangeRowSchema),
    cursor: z.string().nullable().openapi({ description: 'Pass as the next `since`. Null when the feed had no rows.' })
  })
  .openapi('ChangesResponse')

/** A task in a hydrated board view, with the live-claim flag (§5.5). */
export const HydratedTaskSchema = TaskSchema.extend({
  notes: z.string().nullable().optional(),
  claimed: z.boolean().openapi({ description: 'A live lease holds this task.' })
}).openapi('HydratedTask')

export const HydratedBoardResponseSchema = z
  .object({
    board: z.object({
      id: z.string(),
      name: z.string(),
      handle: z.string(),
      repo: z.string().nullable(),
      mode: z.string().openapi({ example: 'automation' }),
      lanes: z.array(LaneSchema),
      schemaId: z.string().nullable(),
      schemaVersion: z.number().nullable(),
      access: z.enum(['owner', 'contributor', 'readonly']),
      ownerUserId: z.string()
    }),
    tasks: z.array(HydratedTaskSchema),
    version: z.number()
  })
  .openapi('HydratedBoardResponse')
