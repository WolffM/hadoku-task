/**
 * Automation-board activation + lane enforcement (§5).
 *
 * Like board-sharing.ts, this talks to D1 directly so the automation concern
 * stays at the route edge — the domain handlers + Storage interface never learn
 * about lanes. A board's tag vocabulary IS the provider's contract: activating
 * replaces the freeform tags with a fixed, ordered lane set and locks that
 * structure (§5.2). The worker holds no policy — it knows only which lanes
 * exist, who may write each, and (in T7) who holds a claim.
 */

import {
  type Lane,
  LaneInvalidError,
  LaneNotEditableError,
  LaneSetInvalidError,
  ActivationDigestMismatchError,
  BoardNotFoundError
} from '@wolffm/task/api'

interface D1Like {
  prepare(sql: string): {
    bind(...args: unknown[]): {
      first<T = unknown>(col?: string): Promise<T | null>
      run(): Promise<{ meta: { changes: number } }>
      all<T = unknown>(): Promise<{ results: T[] }>
    }
  }
  batch(statements: Array<{ run(): Promise<unknown> }>): Promise<unknown>
}

const nowIso = () => new Date().toISOString()

/** Parse the stored `lanes` JSON column into Lane[] (null/blank ⇒ []). */
export function parseLanes(json: string | null | undefined): Lane[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? (v as Lane[]) : []
  } catch {
    return []
  }
}

/** Structural validation of an activation lane set (§5.1): tags unique, editableBy valid, order present. */
export function validateLaneSet(lanes: unknown): Lane[] {
  if (!Array.isArray(lanes) || lanes.length === 0) {
    throw new LaneSetInvalidError('`lanes` must be a non-empty array')
  }
  const seen = new Set<string>()
  for (const raw of lanes) {
    const lane = raw as Record<string, unknown>
    if (typeof lane.tag !== 'string' || lane.tag === '') {
      throw new LaneSetInvalidError('every lane needs a non-empty string `tag`')
    }
    if (/\s/.test(lane.tag)) {
      throw new LaneSetInvalidError(`lane tag "${lane.tag}" may not contain whitespace`)
    }
    if (seen.has(lane.tag)) {
      throw new LaneSetInvalidError(`duplicate lane tag "${lane.tag}"`)
    }
    seen.add(lane.tag)
    if (typeof lane.label !== 'string' || lane.label === '') {
      throw new LaneSetInvalidError(`lane "${lane.tag}" needs a non-empty string \`label\``)
    }
    if (typeof lane.order !== 'number' || !Number.isFinite(lane.order)) {
      throw new LaneSetInvalidError(`lane "${lane.tag}" needs a numeric \`order\``)
    }
    if (lane.editableBy !== 'user' && lane.editableBy !== 'agent') {
      throw new LaneSetInvalidError(`lane "${lane.tag}" \`editableBy\` must be "user" or "agent"`)
    }
  }
  // Unknown keys are preserved verbatim (§5.1) — we validate the four we interpret and keep the rest.
  return lanes as Lane[]
}

/** Index a lane set by tag. */
export function laneByTag(lanes: Lane[]): Map<string, Lane> {
  return new Map(lanes.map(l => [l.tag, l]))
}

/**
 * Enforce a HUMAN-path tag write on an automation board (§5.2). No-op for a
 * standard board (empty lanes). On an automation board a task carries exactly
 * one tag and it must be a lane; a human may only land it in a `user` lane.
 * Clearing the tag (→ Inbox) is always allowed.
 *
 * @throws LaneInvalidError    tag is a free label, multiple tags, or unknown
 * @throws LaneNotEditableError tag is a valid lane but `editableBy: agent`
 */
export function assertHumanLaneWrite(lanes: Lane[], tag: string | null | undefined): void {
  if (lanes.length === 0) return // standard board — freeform, unchanged
  const t = (tag ?? '').trim()
  if (t === '') return // → Inbox, always allowed
  if (/\s/.test(t)) {
    throw new LaneInvalidError('a task on an automation board carries exactly one lane tag')
  }
  const lane = laneByTag(lanes).get(t)
  if (!lane) {
    throw new LaneInvalidError(`"${t}" is not a lane on this board`)
  }
  if (lane.editableBy === 'agent') {
    throw new LaneNotEditableError(t)
  }
}

/** A stable FNV-1a hex digest — content fingerprint, not a security hash. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** The board's automation-relevant state, read in one row. */
export interface BoardConfig {
  name: string
  handle: string
  repo: string | null
  mode: string
  tags: string[]
  lanes: Lane[]
  schemaId: string | null
  schemaVersion: number | null
  previousConfig: string | null
  version: number
  tasksVersion: number
}

/** Read a board's automation config (owner scope). Null ⇒ no such board. */
export async function getBoardConfig(
  db: D1Like,
  ownerId: string,
  boardId: string
): Promise<BoardConfig | null> {
  const row = await db
    .prepare(
      `SELECT name, handle, repo, mode, tags, lanes, schema_id, schema_version, previous_config, version, tasks_version
         FROM boards WHERE user_id = ? AND id = ? LIMIT 1`
    )
    .bind(ownerId, boardId)
    .first<{
      name: string
      handle: string
      repo: string | null
      mode: string
      tags: string | null
      lanes: string | null
      schema_id: string | null
      schema_version: number | null
      previous_config: string | null
      version: number
      tasks_version: number
    }>()
  if (!row) return null
  return {
    name: row.name,
    handle: row.handle,
    repo: row.repo,
    mode: row.mode,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : [],
    lanes: parseLanes(row.lanes),
    schemaId: row.schema_id,
    schemaVersion: row.schema_version,
    previousConfig: row.previous_config,
    version: row.version,
    tasksVersion: row.tasks_version
  }
}

interface TaskTagRow {
  id: string
  tag: string | null
  metadata: string | null
}

/** Where an existing tag lands under a proposed lane set. */
export interface ActivationMappingRow {
  tag: string
  count: number
  lands: 'lane' | 'inbox'
}

export interface ActivationPreview {
  digest: string
  lanes: Lane[]
  mapping: ActivationMappingRow[]
  /** Active tasks that will be cleared into the Inbox (unmapped tag). */
  toInbox: number
  /** Lane tags that already exist as freeform tags on the board (informational). */
  collisions: string[]
}

/** Read the board's active tasks' tags (owner scope). */
async function getActiveTaskTags(
  db: D1Like,
  ownerId: string,
  boardId: string
): Promise<TaskTagRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, tag, metadata FROM tasks
        WHERE user_id = ? AND board_id = ? AND state = 'Active'`
    )
    .bind(ownerId, boardId)
    .all<TaskTagRow>()
  return results
}

/**
 * Compute the activation preview + digest without writing anything (§5.4). The
 * digest fingerprints the board state the preview was computed against, so the
 * committing call can prove nothing changed underneath it.
 */
function buildPreview(cfg: BoardConfig, tasks: TaskTagRow[], lanes: Lane[]): ActivationPreview {
  const laneTags = new Set(lanes.map(l => l.tag))

  // Count active tasks by their current single tag; blank ⇒ already Inbox.
  const counts = new Map<string, number>()
  for (const t of tasks) {
    const tag = (t.tag ?? '').trim()
    if (tag === '') continue
    counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }

  const mapping: ActivationMappingRow[] = [...counts.entries()]
    .map(([tag, count]) => ({
      tag,
      count,
      lands: laneTags.has(tag) ? ('lane' as const) : ('inbox' as const)
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag))

  const toInbox = mapping.filter(m => m.lands === 'inbox').reduce((n, m) => n + m.count, 0)
  const collisions = cfg.tags.filter(t => laneTags.has(t))

  // Digest over the state that matters: current board tags + the per-tag task
  // distribution + the proposed lane vocabulary. Any drift changes it.
  const canonical = JSON.stringify({
    tags: [...cfg.tags].sort(),
    dist: [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    lanes: lanes.map(l => l.tag)
  })

  return { digest: fnv1a(canonical), lanes, mapping, toInbox, collisions }
}

/**
 * How many active tasks a proposed lane set would strand in the Inbox — the same
 * rule `buildPreview` applies, reduced to the one number, and reading task tags
 * a caller already has rather than re-querying.
 *
 * This is the whole of "is this migration safe": zero means every task's current
 * tag survives into the new lane set, so applying it relabels columns and moves
 * no work. Anything above zero is a real migration and belongs in front of a
 * human who can see which tasks are about to be cleared.
 */
export function countStranded(lanes: Lane[], tags: Array<string | null | undefined>): number {
  const laneTags = new Set(lanes.map(l => l.tag))
  let n = 0
  for (const raw of tags) {
    const tag = (raw ?? '').trim()
    if (tag === '' || laneTags.has(tag)) continue // blank is already the Inbox
    n++
  }
  return n
}

export interface ActivatePayload {
  schemaId?: string | null
  schemaVersion?: number | null
  lanes: unknown
  repo?: string | null
}

export interface ActivateResult {
  ok: boolean
  dryRun: boolean
  preview: ActivationPreview
  /** Set on a committed activation. */
  applied?: { mode: 'automation'; laneCount: number; tasksToInbox: number }
}

/**
 * Activate (or re-activate) automation on a board (§5.4). `dryRun` returns the
 * preview + digest and writes nothing. A commit must echo the preview digest
 * (`expectedDigest`); a mismatch → 409 DIGEST_MISMATCH. Owner-scoped: the caller
 * has already been checked as the board owner at the route.
 */
export async function activateAutomation(
  db: D1Like,
  ownerId: string,
  boardId: string,
  payload: ActivatePayload,
  opts: { dryRun: boolean; expectedDigest?: string }
): Promise<ActivateResult> {
  const cfg = await getBoardConfig(db, ownerId, boardId)
  if (!cfg) throw new BoardNotFoundError(boardId)

  const lanes = validateLaneSet(payload.lanes)
  const tasks = await getActiveTaskTags(db, ownerId, boardId)
  const preview = buildPreview(cfg, tasks, lanes)

  if (opts.dryRun) {
    return { ok: true, dryRun: true, preview }
  }

  if (opts.expectedDigest !== undefined && opts.expectedDigest !== preview.digest) {
    throw new ActivationDigestMismatchError(preview.digest)
  }

  const ts = nowIso()
  const laneTags = new Set(lanes.map(l => l.tag))

  // previous_config snapshots the PRE-automation board so deactivate restores the
  // standard tag list (§5.4). Preserve the original across re-activations — only
  // snapshot when the board isn't already in automation mode.
  const previousConfig =
    cfg.mode === 'automation' && cfg.previousConfig
      ? cfg.previousConfig
      : JSON.stringify({ mode: cfg.mode, tags: cfg.tags })

  const stmts: Array<{ run(): Promise<unknown> }> = []

  // Clear every task whose current tag isn't a surviving lane → Inbox, preserving
  // the original tag in metadata.preAutomationTags (only if not already captured,
  // so a re-activation keeps the earliest original). Tasks already in a valid lane
  // are left untouched.
  for (const t of tasks) {
    const tag = (t.tag ?? '').trim()
    if (tag === '' || laneTags.has(tag)) continue
    let metadata: Record<string, unknown> = {}
    if (t.metadata) {
      try {
        metadata = JSON.parse(t.metadata) as Record<string, unknown>
      } catch {
        metadata = {}
      }
    }
    if (!('preAutomationTags' in metadata)) {
      metadata = { ...metadata, preAutomationTags: tag }
    }
    stmts.push(
      db
        .prepare(
          `UPDATE tasks SET tag = NULL, metadata = ?, updated_at = ? WHERE user_id = ? AND id = ?`
        )
        .bind(JSON.stringify(metadata), ts, ownerId, t.id)
    )
  }

  // Replace the board's vocabulary wholesale: mode, lanes, schema labels, repo,
  // and tags = the lane tags (the board's tag list IS the lanes now). Bump both
  // OCC counters since this rewrote metadata AND task tags.
  stmts.push(
    db
      .prepare(
        `UPDATE boards
            SET mode = 'automation', lanes = ?, schema_id = ?, schema_version = ?,
                repo = COALESCE(?, repo), tags = ?, previous_config = ?,
                version = version + 1, tasks_version = tasks_version + 1, updated_at = ?
          WHERE user_id = ? AND id = ?`
      )
      .bind(
        JSON.stringify(lanes),
        payload.schemaId ?? null,
        payload.schemaVersion ?? null,
        payload.repo ?? null,
        JSON.stringify([...laneTags]),
        previousConfig,
        ts,
        ownerId,
        boardId
      )
  )

  await db.batch(stmts)

  return {
    ok: true,
    dryRun: false,
    preview,
    applied: { mode: 'automation', laneCount: lanes.length, tasksToInbox: preview.toInbox }
  }
}

export interface DeactivateResult {
  ok: boolean
  mode: 'standard'
  restoredTags: string[]
}

/**
 * Deactivate automation, restoring the pre-activation structure from
 * previous_config (§5.4). Restores STRUCTURE (the tag list), not per-task lanes —
 * those are recoverable from each task's metadata.preAutomationTags. Owner-scoped.
 */
export async function deactivateAutomation(
  db: D1Like,
  ownerId: string,
  boardId: string
): Promise<DeactivateResult> {
  const cfg = await getBoardConfig(db, ownerId, boardId)
  if (!cfg) throw new BoardNotFoundError(boardId)

  let restoredTags: string[] = []
  if (cfg.previousConfig) {
    try {
      const prev = JSON.parse(cfg.previousConfig) as { tags?: string[] }
      restoredTags = Array.isArray(prev.tags) ? prev.tags : []
    } catch {
      restoredTags = []
    }
  }

  const ts = nowIso()
  await db
    .prepare(
      `UPDATE boards
          SET mode = 'standard', lanes = NULL, schema_id = NULL, schema_version = NULL,
              tags = ?, previous_config = NULL, version = version + 1, updated_at = ?
        WHERE user_id = ? AND id = ?`
    )
    .bind(JSON.stringify(restoredTags), ts, ownerId, boardId)
    .run()

  return { ok: true, mode: 'standard', restoredTags }
}
