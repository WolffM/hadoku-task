/**
 * Reads over the exercise library, sequences and runs, shared by the `library`
 * route group (guest and up, no board) and the `sequences` group (board
 * widgets). Schema-free on purpose: either group imports it without building
 * the other's zod schemas.
 *
 * The model is in worker/migrations/0010_sequences.sql. In short: a head row per
 * exercise / sequence carries its latest `version`; each version is immutable;
 * a sequence version pins exercise versions and a board widget pins a sequence
 * version.
 */
import { tierAtLeast } from '@wolffm/worker-utils'
import type { Context } from 'hono'
import type { AppContext, Env } from '../types'

/** Where cdn.hadoku.me serves an object. An env override lets dev point at a local fake. */
export const DEFAULT_CDN_PUBLIC_BASE = 'https://cdn.hadoku.me'

export function imageUrl(env: Pick<Env, 'CDN_PUBLIC_BASE'>, key: string | null): string | null {
  if (!key) return null
  return `${(env.CDN_PUBLIC_BASE || DEFAULT_CDN_PUBLIC_BASE).replace(/\/$/, '')}/${key}`
}

/** Who is asking, as the library needs it: an identity, and whether they may edit anything. */
export interface Viewer {
  id: string
  isAdmin: boolean
}

/**
 * The library's caller: anyone guest tier and up with an edge-stamped userId.
 * Null for anyone else (public, or a direct workers.dev hit).
 */
export function viewerOf(c: Context<AppContext>): Viewer | null {
  const auth = c.get('authContext')
  if (!auth?.userId || !tierAtLeast(auth, 'guest')) return null
  return { id: auth.userId, isAdmin: tierAtLeast(auth, 'admin') }
}

export const canEdit = (viewer: Viewer, ownerId: string) => viewer.isAdmin || viewer.id === ownerId

export type RefusalCode =
  | 'IDENTITY_REQUIRED'
  | 'FORBIDDEN'
  | 'EXERCISE_NOT_FOUND'
  | 'SEQUENCE_NOT_FOUND'
  | 'RUN_NOT_FOUND'
  | 'WIDGET_NOT_FOUND'
  | 'BOARD_NOT_FOUND'
  | 'RUN_FINISHED'
  | 'NODE_OUT_OF_RANGE'
  | 'IMAGE_UNKNOWN'
  | 'UPLOAD_REFUSED'
  | 'UPLOAD_LIMIT'
  | 'UPLOADS_UNAVAILABLE'

/**
 * A refusal. Thrown by a helper and answered by the error mapping every group
 * shell installs (index.ts installErrorHandlers), which turns `httpStatus` +
 * `code` into `{ error, code }` at that status.
 */
export class Refusal extends Error {
  constructor(
    readonly httpStatus: 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 502 | 503,
    readonly code: RefusalCode,
    message: string
  ) {
    super(message)
  }
}

// ------------------------------------------------------------------ exercises

export interface ExerciseRow {
  id: string
  owner_id: string
  latest_version: number
  deleted_at: string | null
  created_at: string
  updated_at: string
  version: number
  name: string
  description: string | null
  image_key: string | null
  version_at: string
}

/** The SELECT list for an exercise head joined to one of its versions as `v`. */
const EXERCISE_SELECT = `e.id, e.owner_id, e.version AS latest_version, e.deleted_at,
  e.created_at, e.updated_at, v.version, v.name, v.description, v.image_key,
  v.created_at AS version_at`

export function toExercise(env: Env, viewer: Viewer, r: ExerciseRow) {
  return {
    id: r.id,
    version: r.version,
    latestVersion: r.latest_version,
    name: r.name,
    description: r.description,
    imageKey: r.image_key,
    imageUrl: imageUrl(env, r.image_key),
    ownerId: r.owner_id,
    mine: r.owner_id === viewer.id,
    canEdit: canEdit(viewer, r.owner_id),
    deleted: r.deleted_at !== null,
    createdAt: r.created_at,
    // A pinned old version says when IT was made, not when the head last moved.
    updatedAt: r.version === r.latest_version ? r.updated_at : r.version_at
  }
}

export type Exercise = ReturnType<typeof toExercise>

/** One exercise at `version` (default: its latest). Deleted ones resolve too. */
export function readExercise(db: D1Database, id: string, version?: number) {
  return db
    .prepare(
      `SELECT ${EXERCISE_SELECT} FROM exercises e
         JOIN exercise_versions v ON v.exercise_id = e.id AND v.version = ${version ? '?' : 'e.version'}
        WHERE e.id = ?`
    )
    .bind(...(version ? [version, id] : [id]))
    .first<ExerciseRow>()
}

/** The live library (or the caller's part of it), newest first. */
export async function listExercises(
  db: D1Database,
  opts: { q?: string; ownerId?: string; limit?: number }
) {
  const where = ['e.deleted_at IS NULL']
  const args: unknown[] = []
  if (opts.ownerId) {
    where.push('e.owner_id = ?')
    args.push(opts.ownerId)
  }
  if (opts.q) {
    where.push("e.name LIKE ? ESCAPE '\\'")
    args.push(`%${likeEscape(opts.q)}%`)
  }
  const { results } = await db
    .prepare(
      `SELECT ${EXERCISE_SELECT} FROM exercises e
         JOIN exercise_versions v ON v.exercise_id = e.id AND v.version = e.version
        WHERE ${where.join(' AND ')}
        ORDER BY e.updated_at DESC LIMIT ${opts.limit ?? 200}`
    )
    .bind(...args)
    .all<ExerciseRow>()
  return results
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`)

// ------------------------------------------------------------------ sequences

interface SequenceHeadRow {
  id: string
  owner_id: string
  latest_version: number
  deleted_at: string | null
  created_at: string
  updated_at: string
  version: number
  name: string
  description: string | null
  version_at: string
  node_count: number
  timed_seconds: number
  manual_count: number
}

/** Node aggregates for the version joined as `v`. */
const SEQUENCE_SELECT = `s.id, s.owner_id, s.version AS latest_version, s.deleted_at,
  s.created_at, s.updated_at, v.version, v.name, v.description, v.created_at AS version_at,
  (SELECT COUNT(*) FROM sequence_nodes n
    WHERE n.sequence_id = s.id AND n.version = v.version) AS node_count,
  (SELECT COALESCE(SUM(n.seconds), 0) FROM sequence_nodes n
    WHERE n.sequence_id = s.id AND n.version = v.version AND n.mode = 'timed') AS timed_seconds,
  (SELECT COUNT(*) FROM sequence_nodes n
    WHERE n.sequence_id = s.id AND n.version = v.version AND n.mode = 'manual') AS manual_count`

function toSequenceSummary(viewer: Viewer, r: SequenceHeadRow) {
  return {
    id: r.id,
    version: r.version,
    latestVersion: r.latest_version,
    name: r.name,
    description: r.description,
    ownerId: r.owner_id,
    mine: r.owner_id === viewer.id,
    canEdit: canEdit(viewer, r.owner_id),
    deleted: r.deleted_at !== null,
    nodeCount: r.node_count,
    timedSeconds: r.timed_seconds,
    manualCount: r.manual_count,
    createdAt: r.created_at,
    updatedAt: r.version === r.latest_version ? r.updated_at : r.version_at
  }
}

export async function listSequences(
  db: D1Database,
  viewer: Viewer,
  opts: { q?: string; ownerId?: string; limit?: number }
) {
  const where = ['s.deleted_at IS NULL']
  const args: unknown[] = []
  if (opts.ownerId) {
    where.push('s.owner_id = ?')
    args.push(opts.ownerId)
  }
  if (opts.q) {
    where.push("s.name LIKE ? ESCAPE '\\'")
    args.push(`%${likeEscape(opts.q)}%`)
  }
  const { results } = await db
    .prepare(
      `SELECT ${SEQUENCE_SELECT} FROM sequences s
         JOIN sequence_versions v ON v.sequence_id = s.id AND v.version = s.version
        WHERE ${where.join(' AND ')}
        ORDER BY s.updated_at DESC LIMIT ${opts.limit ?? 200}`
    )
    .bind(...args)
    .all<SequenceHeadRow>()
  return results.map(r => toSequenceSummary(viewer, r))
}

interface NodeRow extends ExerciseRow {
  position: number
  mode: string
  seconds: number | null
}

/**
 * Sequences at pinned versions, with every node's exercise resolved at ITS
 * pinned version. Two queries however many are asked for, so a board with many
 * widgets is still one round trip each way. Missing pairs are left out.
 */
export async function readSequences(
  db: D1Database,
  env: Env,
  viewer: Viewer,
  wanted: ReadonlyArray<{ id: string; version?: number }>
) {
  if (wanted.length === 0) return new Map<string, ResolvedSequence>()
  const pairs = wanted.map(() => `(?, ?)`).join(', ')
  // version 0 means "latest": resolved in SQL against the head row.
  const pairArgs = wanted.flatMap(w => [w.id, w.version ?? 0])
  const [heads, nodes] = await db.batch([
    db
      .prepare(
        `WITH want(id, version) AS (VALUES ${pairs})
         SELECT ${SEQUENCE_SELECT} FROM want w
           JOIN sequences s ON s.id = w.id
           JOIN sequence_versions v ON v.sequence_id = s.id
            AND v.version = CASE w.version WHEN 0 THEN s.version ELSE w.version END`
      )
      .bind(...pairArgs),
    db
      .prepare(
        `WITH want(id, version) AS (VALUES ${pairs})
         SELECT n.sequence_id, n.version AS node_version, n.position, n.mode, n.seconds,
                ${EXERCISE_SELECT}
           FROM want w
           JOIN sequences s ON s.id = w.id
           JOIN sequence_nodes n ON n.sequence_id = s.id
            AND n.version = CASE w.version WHEN 0 THEN s.version ELSE w.version END
           JOIN exercises e ON e.id = n.exercise_id
           JOIN exercise_versions v ON v.exercise_id = e.id AND v.version = n.exercise_version
          ORDER BY n.position`
      )
      .bind(...pairArgs)
  ])
  const byKey = new Map<string, ResolvedSequence>()
  const key = (id: string, version: number) => `${id}@${version}`
  for (const r of heads.results as unknown as SequenceHeadRow[]) {
    byKey.set(key(r.id, r.version), { ...toSequenceSummary(viewer, r), nodes: [] })
  }
  for (const r of nodes.results as unknown as Array<
    NodeRow & { sequence_id: string; node_version: number }
  >) {
    byKey.get(key(r.sequence_id, r.node_version))?.nodes.push({
      position: r.position,
      mode: r.mode === 'manual' ? 'manual' : 'timed',
      seconds: r.mode === 'manual' ? null : r.seconds,
      exercise: toExercise(env, viewer, r)
    })
  }
  // Re-key by what was asked, so a "latest" request finds its answer.
  const out = new Map<string, ResolvedSequence>()
  for (const w of wanted) {
    const hit = w.version
      ? byKey.get(key(w.id, w.version))
      : [...byKey.values()].find(s => s.id === w.id && s.version === s.latestVersion)
    if (hit) out.set(key(w.id, w.version ?? 0), hit)
  }
  return out
}

export interface ResolvedSequence extends ReturnType<typeof toSequenceSummary> {
  nodes: Array<{
    position: number
    mode: 'timed' | 'manual'
    seconds: number | null
    exercise: Exercise
  }>
}

export async function readSequence(
  db: D1Database,
  env: Env,
  viewer: Viewer,
  id: string,
  version?: number
) {
  return (await readSequences(db, env, viewer, [{ id, version }])).get(`${id}@${version ?? 0}`)
}

// ------------------------------------------------------------------ runs

export interface RunRow {
  id: string
  runner_id: string
  sequence_id: string
  sequence_version: number
  node_count: number
  widget_id: string | null
  status: string
  started_at: string
  ended_at: string | null
}
interface RunNodeRow {
  run_id: string
  seq: number
  position: number
  exercise_id: string
  exercise_version: number
  outcome: string
  active_ms: number
  started_at: string
  ended_at: string
}

export const RUN_COLS =
  'id, runner_id, sequence_id, sequence_version, node_count, widget_id, status, started_at, ended_at'

const OUTCOMES = new Set(['completed', 'skipped', 'rewound', 'stopped'])

/** Attach each run's node plays and work out whether it was complete. */
export async function withRunNodes(db: D1Database, viewer: Viewer, runs: RunRow[]) {
  if (runs.length === 0) return []
  const { results } = await db
    .prepare(
      `SELECT run_id, seq, position, exercise_id, exercise_version, outcome, active_ms,
              started_at, ended_at
         FROM sequence_run_nodes WHERE run_id IN (${runs.map(() => '?').join(', ')})
        ORDER BY run_id, seq`
    )
    .bind(...runs.map(r => r.id))
    .all<RunNodeRow>()
  const byRun = new Map<string, RunNodeRow[]>()
  for (const n of results) {
    const list = byRun.get(n.run_id) ?? []
    list.push(n)
    byRun.set(n.run_id, list)
  }
  return runs.map(r => {
    const nodes = byRun.get(r.id) ?? []
    const done = new Set(nodes.filter(n => n.outcome === 'completed').map(n => n.position))
    return {
      id: r.id,
      runnerId: r.runner_id,
      mine: r.runner_id === viewer.id,
      sequenceId: r.sequence_id,
      sequenceVersion: r.sequence_version,
      nodeCount: r.node_count,
      widgetId: r.widget_id,
      status: (r.status === 'completed' || r.status === 'stopped' ? r.status : 'active') as
        | 'active'
        | 'completed'
        | 'stopped',
      complete: r.node_count > 0 && done.size === r.node_count,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      nodes: nodes.map(n => ({
        seq: n.seq,
        position: n.position,
        exerciseId: n.exercise_id,
        exerciseVersion: n.exercise_version,
        outcome: (OUTCOMES.has(n.outcome) ? n.outcome : 'stopped') as
          | 'completed'
          | 'skipped'
          | 'rewound'
          | 'stopped',
        activeMs: n.active_ms,
        startedAt: n.started_at,
        endedAt: n.ended_at
      }))
    }
  })
}
