/**
 * The error-body schemas every route group shares: the closed DomainErrorCode
 * set, the catch-all DomainError, and the per-outcome narrowed variants.
 *
 * Split out of schemas-agent.ts so a core UI group (tasks, shares, calendar,
 * tags-batch) can declare its 403/404s without evaluating the agent and
 * automation schemas — worker cold starts pay for every schema a module loads.
 */
import { z } from '@hono/zod-openapi'

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
  // (No BAD_REQUEST: every route now validates its body with zod, so a malformed
  // one is a 400 ZodError from the shared hook, not a coded DomainError. The last
  // hand-rolled emitter went when POST /boards/{ref}/repo became a createRoute.)
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
  'NOTES_CHANGED', // 409 — `ifNotesHash` guard missed (carries `currentNotesHash`)
  // Lanes / automation (§5)
  'LANE_UNKNOWN', // 422 — destination isn't a lane on this board
  'LANE_INVALID', // 422 — a task's tag isn't exactly one lane
  'LANE_NOT_EDITABLE', // 403 — human path can't write an `agent` lane
  'LANE_SET_INVALID', // 422 — activation payload failed structural validation
  'BOARD_SCHEMA_LOCKED', // 409 — lane vocabulary is immutable while automation is on
  'DIGEST_MISMATCH', // 409 — stale activation digest (carries `currentDigest`)
  // Writes (§6)
  'VERSION_CONFLICT', // 409 — If-Match lost (carries `currentVersion`)
  'NOTES_TOO_LARGE', // 413 — notes exceed MAX_NOTES_BYTES
  'STATUS_INVALID' // 422 — `status` isn't { kind: <closed set>, label, href? }
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
  currentNotesHash: z.string().optional().openapi({
    description: 'The notes digest as it now stands, on NOTES_CHANGED. Re-plan against this.'
  }),
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

/**
 * The 403/404 pair every board-scoped route can return, ready to spread into a
 * `responses` block.
 *
 * These come from the shared wrappers — `handleBoardOperation` in route-utils
 * answers 404 BOARD_NOT_FOUND for an unresolvable ref and 403 FORBIDDEN for a
 * readonly grantee — so a route that delegates to them can emit both without
 * saying so anywhere in its own file. Until the handlers were type-checked
 * against their routes, most of them didn't: the spec advertised 200 only, and
 * a generated client had no reason to expect either status.
 */
export const boardErrorResponses = {
  403: {
    description: 'Read-only access to this board, or the route is owner-only (FORBIDDEN)',
    content: { 'application/json': { schema: ForbiddenErrorSchema } }
  },
  404: {
    description: 'No such board, or it is not shared with you (BOARD_NOT_FOUND)',
    content: { 'application/json': { schema: BoardNotFoundErrorSchema } }
  }
}

/** Just the 404 half, for read routes that cannot 403. */
export const boardNotFoundResponse = {
  404: {
    description: 'No such board, or it is not shared with you (BOARD_NOT_FOUND)',
    content: { 'application/json': { schema: BoardNotFoundErrorSchema } }
  }
}

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

/** 409 on /agent/release — LEASE_LOST, or either optional guard missing. */
export const ReleaseConflictErrorSchema = narrowError(
  'ReleaseConflictError',
  ['LEASE_LOST', 'LANE_CHANGED', 'NOTES_CHANGED'],
  'LEASE_LOST: another agent holds the claim. LANE_CHANGED: a human retagged the task under you (`currentLane` carries where it is now). NOTES_CHANGED: a human edited the plan under you (`currentNotesHash` carries the digest it now has). All three wrote nothing.'
)

/** 422 on claim — always LANE_UNKNOWN. */
export const LaneUnknownErrorSchema = narrowError(
  'LaneUnknownError',
  ['LANE_UNKNOWN'],
  'The destination lane is not on this board (e.g. a re-activation removed it).'
)

/** 422 on set-lane / release, which also validate `status`. */
export const LaneOrStatusInvalidErrorSchema = narrowError(
  'LaneOrStatusInvalidError',
  ['LANE_UNKNOWN', 'STATUS_INVALID'],
  'LANE_UNKNOWN: the destination lane is not on this board. STATUS_INVALID: `status` is not { kind: working|waiting|blocked|done, label, href? }. Both wrote nothing.'
)

/** 413 on /agent/release — always NOTES_TOO_LARGE. */
export const NotesTooLargeErrorSchema = narrowError(
  'NotesTooLargeError',
  ['NOTES_TOO_LARGE'],
  'The `notes` body exceeds the 64 KB limit. Nothing was written and you still hold the claim — truncate or link out and retry; do not retry unchanged.'
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

/** The `{ref}` path param of every board-scoped route (a board id or a share alias). */
export const boardRefParam = z.object({
  ref: z.string().openapi({ param: { name: 'ref', in: 'path' }, example: 'main' })
})
