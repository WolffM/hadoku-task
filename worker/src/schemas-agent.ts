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

/**
 * Every machine-readable `code` this API can put in an error body — the CLOSED
 * set, not a sample. Callers branch on the code, never the status: a 409 alone
 * can't tell CLAIM_HELD (someone else has it — take the next task) from
 * LEASE_LOST (your claim is gone — abort and write nothing).
 *
 * A generated client turns this into an enum, so ADDING A CODE WITHOUT ADDING IT
 * HERE breaks consumers at parse time. The list is guarded by
 * `worker/test/openapi-verify.ts`, which greps the source for every emitted code
 * and fails if one isn't declared.
 */
export const DOMAIN_ERROR_CODES = [
  // Access / transport
  'BAD_REQUEST', // 400 — malformed body
  'FORBIDDEN', // 403 — readonly grantee, or not the board owner
  'RATE_LIMITED', // 429 — throttled (carries `retryAfter`)
  // Lookup
  'BOARD_NOT_FOUND', // 404
  'TASK_NOT_FOUND', // 404
  'NAME_NOT_FOUND', // 404 — no registered key with that display name (§7)
  'NO_USER_ID', // 409 — that key never signed in, so it has no id yet (§7)
  // Claim protocol (§4)
  'CLAIM_HELD', // 409 — a live lease exists (carries `holder` + `expiresAt`)
  'LEASE_LOST', // 409 — your token no longer holds the claim; abort
  'LANE_CHANGED', // 409 — `ifCurrentLane` guard missed (carries `currentLane`)
  // Lanes / automation (§5)
  'LANE_UNKNOWN', // 422 — destination isn't a lane on this board
  'LANE_INVALID', // 422 — a task's tag isn't exactly one lane
  'LANE_NOT_EDITABLE', // 403 — human path can't write an `agent` lane
  'LANE_SET_INVALID', // 422 — activation payload failed structural validation
  'BOARD_SCHEMA_LOCKED', // 409 — lane vocabulary is immutable while automation is on
  'DIGEST_MISMATCH', // 409 — stale activation digest (carries `currentDigest`)
  // Writes (§6)
  'VERSION_CONFLICT', // 409 — If-Match lost (carries `currentVersion`)
  'NOTES_TOO_LARGE' // 413 — notes exceed MAX_NOTES_BYTES
] as const

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number]

/** Registered on its own so a generated client gets ONE reusable enum type
 * rather than a fresh inline union per response. */
export const DomainErrorCodeSchema = z.enum(DOMAIN_ERROR_CODES).openapi('DomainErrorCode', {
  description: 'Machine-readable error code. Branch on this, not on the HTTP status.'
})

/** The actionable fields an error body carries alongside `error` + `code`. Kept
 * as a bare shape so every variant below is a FLAT object schema — an `allOf`
 * composition would let a generator merge the narrowed `code` back to the wide
 * union, which is the whole thing we're trying to avoid. */
const domainErrorFields = {
  error: z.string().openapi({ example: 'Task is claimed by agent-x until …' }),
  message: z.string().optional().openapi({ description: 'Extra detail on RATE_LIMITED.' }),
  holder: z.string().optional().openapi({ example: 'agent-x' }),
  expiresAt: z.string().optional().openapi({ example: '2026-07-25T00:38:20.747Z' }),
  currentVersion: z.number().optional(),
  currentLane: z.string().nullable().optional(),
  currentDigest: z.string().optional().openapi({ description: 'Live digest on DIGEST_MISMATCH.' }),
  retryAfter: z.number().optional().openapi({ example: 60 })
}

/** A domain error: `error` message + a machine-readable `code`, plus optional
 * actionable fields (holder/expiry on CLAIM_HELD, currentVersion, currentLane).
 * The catch-all — statuses no route declares (429, 500) surface as this. */
export const DomainErrorSchema = z
  .object({ ...domainErrorFields, code: DomainErrorCodeSchema })
  .openapi('DomainError')

/**
 * A DomainError narrowed to the codes ONE (route, status) pair can actually
 * produce, registered under its own name so the generator emits a distinct type
 * per outcome instead of one catch-all. Derived from the handlers, not guessed:
 * `/agent/heartbeat` 409 is only ever LEASE_LOST, while `/agent/release` 409 is
 * genuinely either LEASE_LOST or LANE_CHANGED.
 */
function narrowError<const C extends readonly [DomainErrorCode, ...DomainErrorCode[]]>(
  refId: string,
  codes: C,
  description: string
) {
  return z
    .object({ ...domainErrorFields, code: z.enum(codes).openapi({ example: codes[0] }) })
    .openapi(refId, { description })
}

/** 403 on every agent / automation / sharing route: readonly grantee, or not the owner. */
export const ForbiddenErrorSchema = narrowError(
  'ForbiddenError',
  ['FORBIDDEN'],
  'Read-only access to this board, or the route is owner-only.'
)

/** 404 where only the board can be missing (heartbeat, set-lane, cancel, history, shares). */
export const BoardNotFoundErrorSchema = narrowError(
  'BoardNotFoundError',
  ['BOARD_NOT_FOUND'],
  'No such board, or it is not shared with you.'
)

/** 404 on claim / release: the board resolves but the task row may not. */
export const TaskOrBoardNotFoundErrorSchema = narrowError(
  'TaskOrBoardNotFoundError',
  ['BOARD_NOT_FOUND', 'TASK_NOT_FOUND'],
  'The board, or the task on it, does not exist.'
)

/** 409 on /agent/claim — always CLAIM_HELD. `holder` + `expiresAt` are always set. */
export const ClaimHeldErrorSchema = narrowError(
  'ClaimHeldError',
  ['CLAIM_HELD'],
  'Another agent holds a live lease. Not your task — move on to the next one. `holder` and `expiresAt` are always present.'
)

/** 409 on /agent/heartbeat and /agent/set-lane — always LEASE_LOST. */
export const LeaseLostErrorSchema = narrowError(
  'LeaseLostError',
  ['LEASE_LOST'],
  'Your lease expired and was taken. Abort and write nothing.'
)

/** 409 on /agent/release — LEASE_LOST or the `ifCurrentLane` guard missing. */
export const ReleaseConflictErrorSchema = narrowError(
  'ReleaseConflictError',
  ['LEASE_LOST', 'LANE_CHANGED'],
  'LEASE_LOST: another agent holds the claim. LANE_CHANGED: a human retagged the task under you (`currentLane` carries where it is now). Both wrote nothing.'
)

/** 422 on claim / set-lane / release — always LANE_UNKNOWN. */
export const LaneUnknownErrorSchema = narrowError(
  'LaneUnknownError',
  ['LANE_UNKNOWN'],
  'The destination lane is not on this board (e.g. a re-activation removed it).'
)

/** 409 on the committing activate-automation call — always DIGEST_MISMATCH. */
export const DigestMismatchErrorSchema = narrowError(
  'DigestMismatchError',
  ['DIGEST_MISMATCH'],
  'The board moved since the dry run. Re-preview and retry; `currentDigest` is the live one.'
)

/** 422 on activate-automation — always LANE_SET_INVALID. */
export const LaneSetInvalidErrorSchema = narrowError(
  'LaneSetInvalidError',
  ['LANE_SET_INVALID'],
  'The `lanes` payload failed structural validation (duplicate tag, bad `editableBy`, missing `order`).'
)

/** 404 on POST shares — the board, or the named key, is missing. */
export const ShareGranteeNotFoundErrorSchema = narrowError(
  'ShareGranteeNotFoundError',
  ['BOARD_NOT_FOUND', 'NAME_NOT_FOUND'],
  'No such board, or no registered key with that display name.'
)

/** 409 on POST shares — always NO_USER_ID. */
export const NoUserIdErrorSchema = narrowError(
  'NoUserIdError',
  ['NO_USER_ID'],
  'That key has never signed in, so it has no stable id to grant against yet.'
)

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
    name: z
      .string()
      .optional()
      .openapi({
        example: 'tenhands-service',
        description:
          'Grantee display name (PREFERRED — no credential changes hands). Resolved case-insensitively against live registry rows.'
      }),
    key: z
      .string()
      .optional()
      .openapi({
        example: 'friend-…',
        description: 'Grantee access key — a bearer credential; prefer `name`.'
      }),
    userId: z
      .string()
      .optional()
      .openapi({ description: 'Grantee userId, if you already have it.' }),
    level: z.enum(['readonly', 'contributor']).openapi({ example: 'contributor' })
  })
  .openapi('GrantShareInput')

export const GrantShareResponseSchema = z
  .object({
    ok: z.boolean(),
    granteeUserId: z.string(),
    granteeName: z.string().nullable().optional(),
    level: z.enum(['readonly', 'contributor']),
    granted: z
      .object({
        name: z.string().nullable(),
        tier: z.string().nullable(),
        level: z.enum(['readonly', 'contributor'])
      })
      .openapi({
        description: 'Echo of what was granted, so the owner can confirm the identity + tier.'
      })
  })
  .openapi('GrantShareResponse')

export const UserSearchResponseSchema = z
  .object({
    users: z.array(
      z.object({
        name: z.string().openapi({ example: 'tenhands-service' }),
        tier: z.string().optional().openapi({ example: 'service' })
      })
    )
  })
  .openapi('UserSearchResponse')

export const ShareRowSchema = z
  .object({
    granteeUserId: z.string(),
    name: z
      .string()
      .nullable()
      .optional()
      .openapi({ description: 'Grantee display name (resolved from the registry).' }),
    tier: z.string().nullable().optional(),
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
    dryRun: z
      .boolean()
      .optional()
      .openapi({ description: 'Preview + digest only; writes nothing.' }),
    digest: z
      .string()
      .optional()
      .openapi({
        description: 'The dryRun digest, echoed on commit (stale ⇒ 409 DIGEST_MISMATCH).'
      })
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

export const RepoValidateResponseSchema = z
  .object({
    repo: z.string().openapi({ example: 'WolffM/hadoku-task' }),
    valid: z.boolean(),
    /** GitHub can't distinguish "doesn't exist" from "private + no access" — both 404. */
    reason: z
      .enum(['ok', 'not_found_or_no_access', 'bad_format', 'token', 'error'])
      .openapi({ example: 'ok' }),
    private: z.boolean().optional(),
    defaultBranch: z.string().optional(),
    message: z.string().optional()
  })
  .openapi('RepoValidateResponse')

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
    ifCurrentLane: z
      .string()
      .optional()
      .openapi({
        description: 'Abort with 409 LANE_CHANGED unless the task is still in this lane.'
      }),
    complete: z
      .boolean()
      .optional()
      .openapi({ description: 'Archive the task on release (claim-gated).' })
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
    cursor: z
      .string()
      .nullable()
      .openapi({ description: 'Pass as the next `since`. Null when the feed had no rows.' })
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
