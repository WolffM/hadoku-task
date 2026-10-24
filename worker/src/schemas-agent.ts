/**
 * Zod schemas for the agent / automation / sharing endpoints (§4–§7).
 *
 * Same source-of-truth pattern as schemas.ts: these both VALIDATE the request and
 * GENERATE the OpenAPI spec (`/task/api/openapi.json`), so a Python consumer like
 * TenHands can codegen a client and catch drift at build time, not runtime.
 */
import { z } from '@hono/zod-openapi'
import { TaskSchema } from './schemas'
import { TASK_STATUS_KINDS, MAX_STATUS_LABEL_LENGTH } from '@wolffm/task/api'

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

/** A lane contract a provider publishes, fetched live rather than pasted (§5.4).
 * Shaped so the UI can hand it straight to activate-automation. */
export const AutomationPresetSchema = z
  .object({
    providerId: z.string().openapi({ example: 'tenhands' }),
    providerLabel: z.string().openapi({ example: 'TenHands' }),
    schemaId: z.string().openapi({ example: 'tenhands' }),
    schemaVersion: z.number().nullable().openapi({ example: 1 }),
    label: z.string().openapi({ example: 'TenHands OSS Contribution' }),
    description: z.string().nullable(),
    lanes: z.array(LaneSchema)
  })
  .openapi('AutomationPreset')

/** Advertised on a hydrated board whose lane set is behind the contract it was
 * activated from (§5.5). Advisory only — the owner still drives the activation
 * handshake; this just says there is something worth offering. Absent when the
 * board is current, isn't an automation board, matches no configured provider,
 * or is being read by someone who couldn't activate it anyway. */
export const PresetUpdateSchema = z
  .object({
    providerId: z.string().openapi({ example: 'tenhands' }),
    providerLabel: z.string().openapi({ example: 'TenHands' }),
    schemaId: z.string().openapi({ example: 'autoland' }),
    schemaVersion: z
      .number()
      .openapi({ example: 2, description: 'What the provider publishes now' }),
    label: z.string().openapi({ example: 'Autoland' }),
    description: z.string().nullable(),
    safe: z
      .boolean()
      .openapi({ description: 'Applying this would move no task (toInbox === 0)', example: true }),
    toInbox: z
      .number()
      .openapi({ description: 'Active tasks that would be cleared to the Inbox', example: 0 })
  })
  .openapi('PresetUpdate')

/** Per-provider fetch outcome, so the picker can distinguish "no presets exist"
 * from "the provider is down and these are the lanes we last saw". */
export const PresetSourceResultSchema = z
  .object({
    id: z.string().openapi({ example: 'tenhands' }),
    label: z.string().openapi({ example: 'TenHands' }),
    url: z.string(),
    ok: z.boolean(),
    count: z.number(),
    cached: z.boolean().optional().openapi({ description: 'Served from memory, no network.' }),
    notModified: z
      .boolean()
      .optional()
      .openapi({ description: 'Revalidated; provider answered 304 (unchanged).' }),
    stale: z
      .boolean()
      .optional()
      .openapi({ description: 'Provider unreachable; this is the last good copy.' }),
    error: z.string().optional()
  })
  .openapi('PresetSourceResult')

export const ListPresetsResponseSchema = z
  .object({
    presets: z.array(AutomationPresetSchema),
    sources: z.array(PresetSourceResultSchema)
  })
  .openapi('ListPresetsResponse')

/** One open issue or PR on a board's repo that the pipeline could take on (§5.6).
 * Sourced from TenHands, which has already dropped the pipeline's own
 * `taskauto/*` PRs and bot authors — this is the list AFTER that filtering. */
export const ActionableItemSchema = z
  .object({
    kind: z.enum(['issue', 'pr']).openapi({ example: 'issue' }),
    number: z.number().openapi({ example: 42 }),
    title: z.string().openapi({ example: 'Board switch drops the filter' }),
    url: z.string().openapi({ example: 'https://github.com/WolffM/hadoku-task/issues/42' }),
    author: z.string().optional(),
    suggestedTitle: z.string().openapi({
      example: 'Address #42',
      description: 'The task title to create. Also what dedup matches on.'
    }),
    bodySnippet: z.string().optional(),
    headRef: z.string().optional().openapi({
      example: 'feature-x',
      description: 'PRs only — the branch a runner checks out to continue the work.'
    })
  })
  .openapi('ActionableItem')

/** The scan result. `ok:false` always names a `reason` — an empty list from a
 * provider outage must not read as "nothing left to do". */
export const ActionableResponseSchema = z
  .object({
    ok: z.boolean(),
    repo: z.string().nullable().openapi({ example: 'WolffM/hadoku-task' }),
    items: z.array(ActionableItemSchema),
    reason: z.string().optional().openapi({
      example: 'no_repo',
      description:
        'Why the list is empty: no_repo, not_automation, signed_out, no_provider_configured, provider_<status>, provider_timeout, provider_unreachable, bad_payload, provider_reported_failure.'
    })
  })
  .openapi('ActionableResponse')

/** Set (or clear) the repo a board drives. Empty string / null / omitted all
 * clear it — the UI clears by blurring an emptied field, not by a DELETE. */
export const SetRepoInputSchema = z
  .object({
    repo: z.string().nullable().optional().openapi({
      example: 'WolffM/hadoku-task',
      description:
        '"owner/name". Empty, null, or omitted clears the mapping. Stored as given — probe it against GitHub with GET /repos/validate first if you want it checked.'
    })
  })
  .openapi('SetRepoInput')

/**
 * The result of an automatic board share. Registered once and reused, so a
 * generated client gets ONE type for every auto-grant rather than a fresh inline
 * shape per route. `granted: false` always names a `reason` — a grant that didn't
 * happen is reported, never silently skipped.
 */
export const AutoShareResultSchema = z
  .object({
    granted: z.boolean(),
    name: z.string().openapi({
      example: 'aggregator-service-key',
      description: 'Registry display name the grantee was resolved by.'
    }),
    granteeUserId: z.string().optional().openapi({ description: 'Set when granted.' }),
    reason: z
      .enum(['already_shared', 'no_registry_row', 'no_user_id', 'registry_unavailable', 'self'])
      .optional()
      .openapi({ description: 'Set when not granted.' })
  })
  .openapi('AutoShareResult')

/** One board's worth of reconcile outcome. */
export const ReconcileBoardSchema = z
  .object({
    boardId: z.string(),
    repo: z.string().nullable(),
    mode: z.string(),
    ownerId: z
      .string()
      .optional()
      .openapi({ description: 'Present on an allOwners sweep — whose board this is.' }),
    grants: z.array(
      z.object({
        kind: z.enum(['repo', 'automation-runner']),
        name: z.string().openapi({ description: 'Target registry display name.' }),
        outcome: z.enum(['granted', 'already_shared', 'escalated', 'skipped']),
        previousLevel: z
          .string()
          .optional()
          .openapi({ description: 'The level replaced, on `escalated`.' }),
        granteeUserId: z.string().optional(),
        reason: z.string().optional().openapi({ description: 'Why, on `skipped`.' })
      })
    )
  })
  .openapi('ReconcileBoard')

export const ReconcileSharesResponseSchema = z
  .object({
    dryRun: z.boolean(),
    allOwners: z.boolean(),
    summary: z.object({
      /** Boards CARRYING A LINK that were considered — not every board that exists. */
      boardsScanned: z.number(),
      boardsWithWork: z.number(),
      granted: z.number(),
      escalated: z.number(),
      alreadyShared: z.number(),
      skipped: z.number()
    }),
    boards: z.array(ReconcileBoardSchema)
  })
  .openapi('ReconcileSharesResponse')

export const ReconcileSharesInputSchema = z
  .object({
    dryRun: z.boolean().optional().openapi({
      description:
        'Defaults to TRUE. A bulk grant across every board you own must be asked for explicitly, so you have to pass `false` to write anything.'
    }),
    force: z.boolean().optional().openapi({
      description:
        "Defaults to TRUE. Upgrades an existing lower-level share to `contributor`, reported as `escalated` with the level it replaced. Pass `false` to leave any existing row alone. Silently does not apply to boards you do not own — another owner's deliberate level is theirs to change."
    }),
    allOwners: z.boolean().optional().openapi({
      description:
        "Sweep EVERY owner's boards, not just your own. Needs a service-tier key (403 otherwise). Safe to expose at that tier because the grantee is fully determined by the board's own repo, or is the fixed automation runner — a caller cannot choose who gets access, so this can only create the shares the system would have made automatically."
    })
  })
  .openapi('ReconcileSharesInput')

export const SetRepoResponseSchema = z
  .object({
    ok: z.boolean(),
    repo: z.string().nullable(),
    // Present when a repo was SET (not cleared): connecting a repo also grants that
    // repo's service key contributor on the board, resolved by the naming
    // convention `<repo, minus a leading "hadoku-">-service-key`.
    serviceKeyShare: AutoShareResultSchema.optional()
  })
  .openapi('SetRepoResponse')

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
    digest: z.string().optional().openapi({
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
      .optional(),
    // Present on a committing activation by the OWNER only. The runner gets
    // `contributor` automatically so an automation board is usable the moment it
    // exists; `granted: false` names why (already shared, no such registry row,
    // registry unreachable) rather than leaving a missing grant to be discovered
    // later as a 403 from the runner.
    automationRunnerShare: AutoShareResultSchema.optional(),
    // Present when the activation also CONNECTED a repo (`repo` in the body), on
    // the same terms: that repo's own service key gets contributor too.
    repoServiceKeyShare: AutoShareResultSchema.optional()
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

/**
 * `{ kind, label, href? }` — what an agent is doing on a task right now (§3.1).
 * `kind` is a closed set the UI styles; `label` is free text nobody parses.
 */
export const TaskStatusSchema = z
  .object({
    kind: z.enum(TASK_STATUS_KINDS).openapi({ example: 'working' }),
    label: z.string().max(MAX_STATUS_LABEL_LENGTH).openapi({ example: 'implementing · 3 files' }),
    href: z.string().optional().openapi({
      description: 'http(s) only — makes the chip a link. Usually the PR.',
      example: 'https://github.com/WolffM/hadoku-conjure/pull/42'
    })
  })
  .openapi('TaskStatus')

export const SetLaneInputSchema = z
  .object({
    board: z.string(),
    taskId: z.string(),
    token: z.string(),
    lane: z.string(),
    status: TaskStatusSchema.nullable().optional().openapi({
      description:
        'Report progress without releasing. Omit to leave the status alone, null to clear it.'
    })
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
    ifCurrentLane: z.string().optional().openapi({
      description: 'Abort with 409 LANE_CHANGED unless the task is still in this lane.'
    }),
    ifNotesHash: z
      .string()
      .optional()
      .openapi({
        description:
          "Abort with 409 NOTES_CHANGED unless the task's notes still hash to this. " +
          'Lowercase hex SHA-256 of the UTF-8 notes; absent notes hash as the empty string. ' +
          'The 409 body carries `currentNotesHash` to re-plan against.',
        example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      }),
    status: TaskStatusSchema.nullable().optional().openapi({
      description: 'The agent status chip. Omit to leave it alone, null to clear it.'
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
      ownerUserId: z.string(),
      presetUpdate: PresetUpdateSchema.optional()
    }),
    tasks: z.array(HydratedTaskSchema),
    version: z.number()
  })
  .openapi('HydratedBoardResponse')
