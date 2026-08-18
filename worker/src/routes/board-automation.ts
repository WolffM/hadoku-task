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
  BoardNotFoundError,
  DomainError
} from '@wolffm/task/api'
import { logger } from '../logger'
import type { Access } from './board-sharing'

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

/**
 * The wake signal: was this write made by a HUMAN?
 *
 * Deliberately STRUCTURAL, not semantic. Which lanes are claimable is the
 * runner's business (`agent.ts`: the worker performs no orchestration), and it
 * changes on the runner's schedule — so this never names `approved` or any other
 * lane. It answers only "did a person touch something on this board?". The
 * runner decides whether that is actionable, and gains a lane without a change
 * landing here.
 *
 * ONE exclusion does the filtering:
 *
 *   - **An `agent` lane is not a signal.** Those are the pipeline's own writes;
 *     it does not need waking to hear from itself.
 *
 * A CLEARED TAG (→ Inbox) IS A SIGNAL, and used not to be. The reasoning for
 * excluding it was sound and the conclusion was still wrong: the runner waits
 * for edits to settle before planning an Inbox task, so pushing on every save
 * looked like it would defeat the settle window. What it actually did was leave
 * *creating a task* — the single most common thing a person does on a board —
 * as the one action with no fast path at all. Those captures fell through to a
 * backstop cron that GitHub throttles to a ~45-minute median, so the most
 * ordinary action had by far the worst latency.
 *
 * The settle window is the runner's policy and is now enforced where it
 * belongs: the runner sleeps out the remainder before it sweeps
 * (`taskauto.yml`, "Let a fresh capture settle"). That keeps this predicate
 * free of runner policy, which is the property the whole file is built around.
 * Over-firing is cheap here — an idle sweep is ~18 seconds — and under-firing
 * is what cost 45 minutes.
 */
export function isUserLaneWrite(lanes: Lane[], tag: string | null | undefined): boolean {
  const t = (tag ?? '').trim()
  if (t === '') return true
  return laneByTag(lanes).get(t)?.editableBy === 'user'
}

/** GitHub's `event_type`. The runner's workflow triggers on exactly this string. */
const DISPATCH_EVENT_TYPE = 'taskauto'
/** A hung dispatch must not hold a `waitUntil` open. */
const DISPATCH_TIMEOUT_MS = 5000
/** `owner/name` — the shape the repo-validate route accepts (schemas/autoland-v1.json). */
const REPO_SHAPE = /^[\w.-]+\/[\w.-]+$/

/**
 * The worker's GitHub credential — for the repo-validation READ and the
 * lane-change dispatch WRITE alike. Both go through here rather than reaching for
 * the binding, so "which credential does GitHub see" has one answer, and giving
 * the write its own narrower token later is a change to this function instead of a
 * hunt through call sites.
 *
 * The binding is named `GITHUB_READ_TOKEN` for a reason worth not re-litigating:
 * that is the name already deployed, and renaming a live secret to improve a
 * comment would break both uses until an operator pushed the new one. The name is
 * a little wrong; the indirection is where the honesty lives.
 */
/** Probe GitHub to validate a board's `repo` (owner/name). 404 is ambiguous —
 * GitHub returns it for both "no such repo" and "private repo the token can't
 * see" (it won't leak private-repo existence), so the caller phrases it as both. */
export async function validateRepo(
  repo: string,
  token: string | undefined
): Promise<{
  repo: string
  valid: boolean
  // The exact five the published RepoValidateResponse enum names. `string` here
  // meant the compiler could not tell whether the handler and the spec still
  // agreed — and a sixth reason could have shipped without anyone noticing.
  reason: 'ok' | 'not_found_or_no_access' | 'bad_format' | 'token' | 'error'
  private?: boolean
  defaultBranch?: string
  message?: string
}> {
  const trimmed = repo.trim()
  if (!/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return {
      repo: trimmed,
      valid: false,
      reason: 'bad_format',
      message: 'Use the "owner/repo" form.'
    }
  }
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'hadoku-task'
  }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(`https://api.github.com/repos/${trimmed}`, { headers })
    if (res.status === 200) {
      const data = (await res.json()) as {
        private?: boolean
        default_branch?: string
        full_name?: string
      }
      return {
        repo: data.full_name ?? trimmed,
        valid: true,
        reason: 'ok',
        private: data.private,
        defaultBranch: data.default_branch
      }
    }
    if (res.status === 404) {
      return {
        repo: trimmed,
        valid: false,
        reason: 'not_found_or_no_access',
        message: token
          ? 'No such repo, or it is private and our GitHub token lacks access — grant the WolffM token access to it, then re-check.'
          : 'No such public repo (private-repo validation needs the GitHub token binding).'
      }
    }
    if (res.status === 401 || res.status === 403) {
      return {
        repo: trimmed,
        valid: false,
        reason: 'token',
        message: 'GitHub rejected our token (scope/rate limit).'
      }
    }
    return {
      repo: trimmed,
      valid: false,
      reason: 'error',
      message: `GitHub returned ${res.status}.`
    }
  } catch {
    return { repo: trimmed, valid: false, reason: 'error', message: 'Could not reach GitHub.' }
  }
}

export function githubToken(env: { GITHUB_READ_TOKEN?: string }): string | undefined {
  return env.GITHUB_READ_TOKEN
}

/**
 * WHERE the wake signal goes — the repo hosting the RUNNER's workflow, which is
 * not the repo the board does its work in.
 *
 * That distinction cost three days of a silently dead fast path. The dispatch
 * used to go to `cfg.repo`, on the reasonable-sounding assumption that a board
 * wired to a repo gets woken by something in that repo. It doesn't: TenHands
 * runs ONE workflow — `.github/workflows/taskauto.yml` in `WolffM/tenhands` —
 * that sweeps every board shared with it. So a task written on the `pygmalion`
 * board dispatched to `WolffM/hadoku-pygmalion`, which has no workflow listening
 * for `taskauto`, and GitHub discarded it silently. Six of seven boards had no
 * fast path at all; the seventh worked only because it IS the tenhands board,
 * where `cfg.repo` happens to equal the runner's repo — which is also why the
 * verification harness never caught it (it hard-coded one repo for both roles).
 *
 * An install-level binding rather than per-board config, because that matches
 * the fact: boards are DISCOVERED by the runner — anything shared with its key —
 * so one runner drives all of them. Same reasoning as AUTOMATION_RUNNER_KEY_NAME
 * beside it in `Env`: the runner's identity and location are install facts that
 * change without a code deploy. If a second runner ever drives a subset of
 * boards, THAT is when this earns a per-board field; adding one now would be a
 * lie with a default.
 *
 * Unset ⇒ fall back to `cfg.repo`, the historical behaviour, which is correct
 * whenever the board's repo IS the runner's repo.
 */
export function runnerRepo(env: { AUTOMATION_RUNNER_REPO?: string }): string | undefined {
  const r = (env.AUTOMATION_RUNNER_REPO ?? '').trim()
  return r === '' ? undefined : r
}

/** What a hook site supplies to {@link notifyLaneWrite}. */
export interface LaneWriteNotice {
  db: D1Like
  /** The board OWNER's userId — the scope `getBoardConfig` reads under. */
  ownerId: string
  /** The owner's board slug (not a shared handle the caller may have passed). */
  boardId: string
  taskId: string
  /** The lane tag this write landed the task in. */
  laneTag: string | null | undefined
  /** The board's lane set, already resolved by the caller — saves a re-read. */
  lanes: Lane[]
  /** 'standard' | 'automation', as resolved for the write. */
  mode: string
  /** The dispatch PAT. Absent ⇒ skip silently; an unconfigured install must not fail writes. */
  token: string | undefined
  /**
   * The runner's repo, from {@link runnerRepo}. Absent ⇒ dispatch to the board's
   * own `cfg.repo`. Supplied by the caller alongside `token` so both GitHub
   * facts arrive from the same place — the env — rather than one being read
   * here and the other passed in.
   */
  runnerRepo?: string | undefined
}

/**
 * POST the `repository_dispatch`. Never throws and never retries: the runner's
 * cron is the delivery guarantee, this is only the fast path (§ "No delivery
 * guarantee"). A `204` is success; anything else is logged and dropped.
 */
async function postDispatch(repo: string, token: string, payload: Record<string, unknown>) {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'hadoku-task-worker',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ event_type: DISPATCH_EVENT_TYPE, client_payload: payload }),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS)
    })
    if (res.status === 204) {
      logger.info('lane-change dispatch sent', { repo, ...payload })
      return
    }
    // GitHub answers 404 — not 403 — when the token can't see a private repo, so
    // an under-scoped PAT looks like a missing repo. Log the status either way.
    logger.warn('lane-change dispatch rejected', {
      repo,
      status: res.status,
      body: (await res.text().catch(() => '')).slice(0, 200)
    })
  } catch (e) {
    logger.warn('lane-change dispatch failed', {
      repo,
      error: e instanceof Error ? e.message : String(e)
    })
  }
}

/**
 * Read the board's `repo` + `handle` and dispatch. Never throws. The config read
 * happens here rather than in the caller so a board with no repo — the common
 * case — costs nothing until the cheap structural predicate has already passed.
 */
async function dispatchLaneWrite(n: LaneWriteNotice, token: string): Promise<void> {
  let cfg: BoardConfig | null = null
  try {
    cfg = await getBoardConfig(n.db, n.ownerId, n.boardId)
  } catch (e) {
    logger.warn('lane-change dispatch: board config unreadable', {
      boardId: n.boardId,
      error: e instanceof Error ? e.message : String(e)
    })
    return
  }
  if (!cfg || cfg.mode !== 'automation') return

  // Still gated on the BOARD having a repo, even though we may not dispatch
  // there: a board with no repo has no work target, so waking the runner for it
  // would be pointless. This keeps the "a board with no repo costs nothing"
  // property the config read is positioned for.
  const boardRepo = (cfg.repo ?? '').trim()
  if (!boardRepo || !REPO_SHAPE.test(boardRepo)) return

  // The runner's repo when configured, the board's own only as a fallback.
  // See {@link runnerRepo} for why these are different things.
  const target = n.runnerRepo ?? boardRepo
  if (!REPO_SHAPE.test(target)) {
    // Misconfigured binding. Say so loudly rather than falling back to the
    // board repo: a silent fallback here is exactly the failure that hid a dead
    // fast path for three days, and it would hide it again.
    logger.warn('lane-change dispatch: AUTOMATION_RUNNER_REPO is not owner/name', {
      value: target
    })
    return
  }

  await postDispatch(target, token, {
    boardId: n.boardId,
    handle: cfg.handle,
    taskId: n.taskId,
    lane: (n.laneTag ?? '').trim(),
    // The board's OWN repo, which is not necessarily where this dispatch went.
    // Carried so a run's log answers "which board woke me" without the reader
    // having to know that the two can differ — the thing nobody knew before.
    repo: boardRepo,
    at: nowIso()
  })
}

/**
 * Wake the runner: a human just landed a task in a `user` lane on an automation
 * board wired to a repo. ALWAYS call this AFTER the write commits — a dispatch
 * for a write that then failed validation sends the pipeline looking for a task
 * that never moved.
 *
 * `host` is the transport's context object, read ONLY for an ExecutionContext to
 * hang the call on. `c.executionCtx` is a **THROWING GETTER**, not a
 * possibly-undefined property — `c.executionCtx?.waitUntil(p)` reads as safe and
 * is not, it raises "This context has no ExecutionContext" wherever one isn't
 * supplied (a direct `app.request()` caller, and the MCP path). Hence the
 * try/catch, and hence owning the hazard here rather than at three call sites.
 *
 * Where there is no ExecutionContext the dispatch is awaited INLINE instead of
 * skipped. It is timeout-bounded and cannot throw, so the cost is bounded; and a
 * wake signal is not a nicety like `warmPresets` — dropping it on the dev stack
 * and in the verify harnesses would mean the thing is never exercised outside
 * production. Cloudflare always supplies an ExecutionContext, so the human's
 * write never waits on GitHub in prod.
 */
export async function notifyLaneWrite(n: LaneWriteNotice, host: unknown): Promise<void> {
  if (n.mode !== 'automation') return
  if (!n.token) return
  if (!isUserLaneWrite(n.lanes, n.laneTag)) return

  const pending = dispatchLaneWrite(n, n.token)

  let waitUntil: ((p: Promise<unknown>) => void) | null = null
  try {
    const ctx = (host as { executionCtx?: { waitUntil(p: Promise<unknown>): void } }).executionCtx
    if (ctx && typeof ctx.waitUntil === 'function') waitUntil = ctx.waitUntil.bind(ctx)
  } catch {
    // No ExecutionContext here — fall through and await inline.
  }
  if (waitUntil) {
    waitUntil(pending)
    return
  }
  await pending
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
 * (`expectedDigest`); a mismatch → 409 DIGEST_MISMATCH.
 *
 * `access` decides how far the caller may go, and the split is deliberate:
 *
 *   - **owner** — anything, including the first conversion and a migration that
 *     displaces tasks.
 *   - **contributor** — may UPGRADE a board that is already in automation mode,
 *     provided the new lane set strands nothing (`preview.toInbox === 0`). This
 *     is what lets a provider ship a schema version without a human in the loop:
 *     re-orders, renames of non-lane metadata, added lanes, version bumps.
 *   - anything else — refused.
 *
 * The line is drawn at `toInbox` rather than at "is it the same schemaId" because
 * toInbox is the only thing that measures actual harm: it counts tasks whose
 * current lane would vanish, which is precisely the case a human should look at.
 * A provider that genuinely needs to strand tasks still can — it just needs the
 * owner, which is the point.
 */
export async function activateAutomation(
  db: D1Like,
  ownerId: string,
  boardId: string,
  payload: ActivatePayload,
  opts: { dryRun: boolean; expectedDigest?: string; access?: Access }
): Promise<ActivateResult> {
  const cfg = await getBoardConfig(db, ownerId, boardId)
  if (!cfg) throw new BoardNotFoundError(boardId)

  const lanes = validateLaneSet(payload.lanes)
  const tasks = await getActiveTaskTags(db, ownerId, boardId)
  const preview = buildPreview(cfg, tasks, lanes)

  // A dry run writes nothing, so anyone with write access may run one — a
  // contributor needs it to discover whether its upgrade is committable.
  if (opts.dryRun) {
    return { ok: true, dryRun: true, preview }
  }

  const access = opts.access ?? 'owner'
  if (access !== 'owner') {
    if (access !== 'contributor') {
      throw new DomainError(
        'Only a contributor or the owner can activate automation',
        'FORBIDDEN',
        403
      )
    }
    if (cfg.mode !== 'automation') {
      throw new DomainError(
        'Converting a standard board to an automation board is owner-only; a contributor may only upgrade a board that is already automated.',
        'FORBIDDEN',
        403
      )
    }
    if (preview.toInbox > 0) {
      throw new DomainError(
        `This lane set would strand ${preview.toInbox} task(s) in the Inbox, so it needs the board owner. A contributor may only apply a lane set that displaces nothing.`,
        'FORBIDDEN',
        403
      )
    }
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
