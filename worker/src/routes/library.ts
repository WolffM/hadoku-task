/**
 * The exercise library: exercises, sequences, their pictures, and runs.
 *
 * SHARED, guest tier and up. Anyone with an edge-stamped identity at guest or
 * above can list and use anyone's exercises and sequences, and make their own.
 * Only the owner, or an admin, may change or delete one. This group is NOT a
 * storage group (route-groups.ts): a guest has no boards on the server (#107),
 * but the library is not board storage, and everything here is keyed by the
 * caller's userId, which account erase reaches.
 *
 * Edits are new versions and deletes are soft (0010_sequences.sql), so nothing
 * here can change what another person has pinned on their board.
 *
 * Runs are logged per RUNNER, with every node play a row: complete, skipped,
 * rewound (left by going back) or stopped (player closed). Started from a board
 * widget, a run also names the board and widget, which needs write access to
 * that board.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { TaskUtils } from '@wolffm/task/api'
import { EDGE_BASE } from '@wolffm/worker-utils/edge-routes'
import { getBoardContext } from './route-utils'
import {
  RUN_COLS,
  canEdit,
  imageUrl,
  listExercises,
  listSequences,
  readExercise,
  readSequence,
  toExercise,
  viewerOf,
  withRunNodes,
  Refusal,
  type RunRow,
  type Viewer
} from './library-store'
import {
  DomainErrorSchema,
  ForbiddenErrorSchema,
  IdentityRequiredErrorSchema,
  LibraryNotFoundErrorSchema
} from '../schemas-errors'
import {
  DeletedResponseSchema,
  ExerciseInputSchema,
  ExerciseResponseSchema,
  FinishRunInputSchema,
  IMAGE_KEY_RE,
  ImageUploadResponseSchema,
  LibraryQuerySchema,
  ListExercisesResponseSchema,
  ListRunsQuerySchema,
  ListRunsResponseSchema,
  ListSequencesResponseSchema,
  RunNodeInputSchema,
  RunResponseSchema,
  SequenceInputSchema,
  SequenceResponseSchema,
  StartRunInputSchema,
  VersionQuerySchema
} from '../schemas-sequences'
import type { AppContext, Env } from '../types'

/** Pictures are photos or short GIFs of a movement; the CDN's own cap is 10 MB. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** Per person per rolling day. task uploads under its own key, so this is the only brake. */
export const DAILY_UPLOAD_CAP = 30
const DAY_MS = 24 * 60 * 60 * 1000
const CDN_UPLOAD_URL = `${EDGE_BASE}/cdn/api/upload`
const CDN_TIMEOUT_MS = 20_000

const json = <S extends z.ZodTypeAny>(schema: S) => ({ 'application/json': { schema } })
const unauthorized = {
  description: 'No signed-in identity at guest tier or above (IDENTITY_REQUIRED)',
  content: json(IdentityRequiredErrorSchema)
}
const forbidden = {
  description: "Not the owner and not an admin, or read-only on the run's board (FORBIDDEN)",
  content: json(ForbiddenErrorSchema)
}
const notFound = { description: 'Not found', content: json(LibraryNotFoundErrorSchema) }
const domainError = (description: string) => ({ description, content: json(DomainErrorSchema) })

const idParam = z.object({ id: z.string().openapi({ param: { name: 'id', in: 'path' } }) })

const need = (c: Context<AppContext>): Viewer => {
  const v = viewerOf(c)
  if (!v) {
    throw new Refusal(401, 'IDENTITY_REQUIRED', 'Sign in to use the exercise library')
  }
  return v
}

const nowIso = () => new Date().toISOString()

/**
 * An image key may be attached only if it came through POST /library/images,
 * or an exercise already uses it (an edit keeping its picture). Anything else
 * would let a client point an exercise at whatever the CDN holds.
 */
async function assertKnownImage(db: D1Database, key: string | null | undefined) {
  if (!key) return
  const row = await db
    .prepare(
      `SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM library_uploads WHERE image_key = ?)
          OR EXISTS (SELECT 1 FROM exercise_versions WHERE image_key = ?)`
    )
    .bind(key, key)
    .first<{ ok: number }>()
  if (!row) {
    throw new Refusal(422, 'IMAGE_UNKNOWN', 'That picture was not uploaded through the library')
  }
}

/** The exercise head, or 404. */
async function exerciseHead(db: D1Database, id: string) {
  const row = await db
    .prepare('SELECT owner_id, version, deleted_at FROM exercises WHERE id = ?')
    .bind(id)
    .first<{ owner_id: string; version: number; deleted_at: string | null }>()
  if (!row) throw new Refusal(404, 'EXERCISE_NOT_FOUND', `Exercise ${id} not found`)
  return row
}

async function sequenceHead(db: D1Database, id: string) {
  const row = await db
    .prepare('SELECT owner_id, version, deleted_at FROM sequences WHERE id = ?')
    .bind(id)
    .first<{ owner_id: string; version: number; deleted_at: string | null }>()
  if (!row) throw new Refusal(404, 'SEQUENCE_NOT_FOUND', `Sequence ${id} not found`)
  return row
}

const assertEditor = (viewer: Viewer, ownerId: string, what: string) => {
  if (!canEdit(viewer, ownerId)) {
    throw new Refusal(403, 'FORBIDDEN', `Only its owner or an admin can change this ${what}`)
  }
}

/**
 * Resolve a sequence input's nodes to pinned exercise versions. An exercise
 * deleted from the library can't be newly added, but one the sequence already
 * pins at that version (an edit of the sequence) stays allowed.
 */
async function resolveNodes(
  db: D1Database,
  nodes: z.infer<typeof SequenceInputSchema>['nodes'],
  alreadyPinned: ReadonlySet<string>
) {
  const ids = [...new Set(nodes.map(n => n.exerciseId))]
  const { results } = await db
    .prepare(
      `SELECT e.id, e.version, e.deleted_at,
              (SELECT group_concat(version) FROM exercise_versions WHERE exercise_id = e.id) AS versions
         FROM exercises e WHERE e.id IN (${ids.map(() => '?').join(', ')})`
    )
    .bind(...ids)
    .all<{ id: string; version: number; deleted_at: string | null; versions: string }>()
  const byId = new Map(results.map(r => [r.id, r]))
  return nodes.map((n, position) => {
    const ex = byId.get(n.exerciseId)
    if (!ex) throw new Refusal(404, 'EXERCISE_NOT_FOUND', `Exercise ${n.exerciseId} not found`)
    const version = n.exerciseVersion ?? ex.version
    if (!ex.versions.split(',').map(Number).includes(version)) {
      throw new Refusal(
        404,
        'EXERCISE_NOT_FOUND',
        `Exercise ${n.exerciseId} has no version ${version}`
      )
    }
    if (ex.deleted_at && !alreadyPinned.has(`${n.exerciseId}@${version}`)) {
      throw new Refusal(404, 'EXERCISE_NOT_FOUND', `Exercise ${n.exerciseId} was deleted`)
    }
    return {
      position,
      exerciseId: n.exerciseId,
      exerciseVersion: version,
      mode: n.mode,
      seconds: n.mode === 'timed' ? (n.seconds ?? null) : null
    }
  })
}

function insertSequenceVersion(
  db: D1Database,
  id: string,
  version: number,
  input: z.infer<typeof SequenceInputSchema>,
  nodes: Awaited<ReturnType<typeof resolveNodes>>,
  editor: string,
  at: string
) {
  return [
    db
      .prepare(
        `INSERT INTO sequence_versions (sequence_id, version, name, description, edited_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(id, version, input.name, input.description || null, editor, at),
    ...nodes.map(n =>
      db
        .prepare(
          `INSERT INTO sequence_nodes
             (sequence_id, version, position, exercise_id, exercise_version, mode, seconds)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(id, version, n.position, n.exerciseId, n.exerciseVersion, n.mode, n.seconds)
    )
  ]
}

async function mustReadSequence(c: Context<AppContext>, viewer: Viewer, id: string, v?: number) {
  const seq = await readSequence(c.env.DB, c.env, viewer, id, v)
  if (!seq) {
    throw new Refusal(404, 'SEQUENCE_NOT_FOUND', `Sequence ${id}${v ? ` v${v}` : ''} not found`)
  }
  return seq
}

async function mustReadExercise(c: Context<AppContext>, viewer: Viewer, id: string, v?: number) {
  const row = await readExercise(c.env.DB, id, v)
  if (!row) {
    throw new Refusal(404, 'EXERCISE_NOT_FOUND', `Exercise ${id}${v ? ` v${v}` : ''} not found`)
  }
  return toExercise(c.env, viewer, row)
}

async function readRun(db: D1Database, viewer: Viewer, id: string) {
  const row = await db
    .prepare(`SELECT ${RUN_COLS} FROM sequence_runs WHERE id = ? AND runner_id = ?`)
    .bind(id, viewer.id)
    .first<RunRow>()
  if (!row) throw new Refusal(404, 'RUN_NOT_FOUND', `Run ${id} not found`)
  return row
}

/** Read a body up to `limit` bytes; null if it is longer. */
async function readBounded(body: Request['body'], limit: number) {
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

/**
 * Forward a picture to cdn.hadoku.me under task's own service key. The CDN
 * decides the type from the bytes and refuses anything that isn't inert media;
 * task then keeps only images (the CDN also takes audio).
 */
async function uploadToCdn(env: Env, bytes: Uint8Array) {
  const key = (env.HADOKU_SERVICE_KEY ?? '').trim()
  if (!key) {
    throw new Refusal(503, 'UPLOADS_UNAVAILABLE', 'Picture uploads are not configured here')
  }
  let res: Response
  try {
    res = await fetch(CDN_UPLOAD_URL, {
      method: 'POST',
      headers: {
        'X-User-Key': key,
        'User-Agent': 'hadoku-task-worker',
        'Content-Type': 'application/octet-stream'
      },
      body: bytes,
      signal: AbortSignal.timeout(CDN_TIMEOUT_MS)
    })
  } catch (e) {
    throw new Refusal(502, 'UPLOADS_UNAVAILABLE', `The picture store did not answer: ${String(e)}`)
  }
  const body = (await res.json().catch(() => ({}))) as {
    key?: string
    contentType?: string
    message?: string
  }
  if (res.status === 413 || res.status === 415 || res.status === 400) {
    throw new Refusal(
      res.status === 400 ? 415 : res.status,
      'UPLOAD_REFUSED',
      body.message || 'The picture was refused'
    )
  }
  if (!res.ok || typeof body.key !== 'string') {
    throw new Refusal(502, 'UPLOADS_UNAVAILABLE', `The picture store answered ${res.status}`)
  }
  if (!body.contentType?.startsWith('image/') || !IMAGE_KEY_RE.test(body.key)) {
    throw new Refusal(415, 'UPLOAD_REFUSED', 'Only pictures (PNG, JPEG, GIF, WebP, AVIF)')
  }
  return body.key
}

export function createLibraryRoutes() {
  const app = new OpenAPIHono<AppContext>()

  // ================================================================ exercises

  app.openapi(
    createRoute({
      method: 'get',
      path: '/library/exercises',
      tags: ['Library'],
      summary: 'Exercises in the shared library',
      request: { query: LibraryQuerySchema },
      responses: {
        200: { description: 'Latest version of each', content: json(ListExercisesResponseSchema) },
        401: unauthorized
      }
    }),
    async c => {
      const viewer = need(c)
      const { q, mine } = c.req.valid('query')
      const rows = await listExercises(c.env.DB, {
        q,
        ownerId: mine === '1' ? viewer.id : undefined
      })
      return c.json({ exercises: rows.map(r => toExercise(c.env, viewer, r)) }, 200)
    }
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/library/exercises',
      tags: ['Library'],
      summary: 'Make an exercise',
      request: { body: { content: json(ExerciseInputSchema) } },
      responses: {
        200: { description: 'Created at version 1', content: json(ExerciseResponseSchema) },
        401: unauthorized,
        422: domainError('An image key that was not uploaded here (IMAGE_UNKNOWN)')
      }
    }),
    async c => {
      const viewer = need(c)
      const input = c.req.valid('json')
      await assertKnownImage(c.env.DB, input.imageKey)
      const id = TaskUtils.generateULID()
      const at = nowIso()
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO exercises (id, owner_id, version, name, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?, ?)`
        ).bind(id, viewer.id, input.name, at, at),
        c.env.DB.prepare(
          `INSERT INTO exercise_versions
             (exercise_id, version, name, description, image_key, edited_by, created_at)
           VALUES (?, 1, ?, ?, ?, ?, ?)`
        ).bind(id, input.name, input.description || null, input.imageKey ?? null, viewer.id, at)
      ])
      return c.json({ ok: true as const, exercise: await mustReadExercise(c, viewer, id) }, 200)
    }
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/library/exercises/{id}',
      tags: ['Library'],
      summary: 'One exercise, at its latest or a given version',
      request: { params: idParam, query: VersionQuerySchema },
      responses: {
        200: { description: 'The exercise', content: json(ExerciseResponseSchema) },
        401: unauthorized,
        404: notFound
      }
    }),
    async c => {
      const viewer = need(c)
      const { id } = c.req.valid('param')
      const { version } = c.req.valid('query')
      return c.json(
        { ok: true as const, exercise: await mustReadExercise(c, viewer, id, version) },
        200
      )
    }
  )

  app.openapi(
    createRoute({
      method: 'put',
      path: '/library/exercises/{id}',
      tags: ['Library'],
      summary: 'Edit an exercise: saves a new version',
      description:
        'Sequences pinned to earlier versions keep them. Owner or admin only. A deleted exercise cannot be edited.',
      request: { params: idParam, body: { content: json(ExerciseInputSchema) } },
      responses: {
        200: { description: 'The new version', content: json(ExerciseResponseSchema) },
        401: unauthorized,
        403: forbidden,
        404: notFound,
        422: domainError('An image key that was not uploaded here (IMAGE_UNKNOWN)')
      }
    }),
    async c => {
      const viewer = need(c)
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')
      const head = await exerciseHead(c.env.DB, id)
      assertEditor(viewer, head.owner_id, 'exercise')
      if (head.deleted_at)
        throw new Refusal(404, 'EXERCISE_NOT_FOUND', `Exercise ${id} was deleted`)
      await assertKnownImage(c.env.DB, input.imageKey)
      const at = nowIso()
      // The version comes from the head INSIDE the batch, so two saves racing
      // can't both write version n+1: the second insert hits the primary key.
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO exercise_versions
             (exercise_id, version, name, description, image_key, edited_by, created_at)
           SELECT id, version + 1, ?, ?, ?, ?, ? FROM exercises WHERE id = ?`
        ).bind(input.name, input.description || null, input.imageKey ?? null, viewer.id, at, id),
        c.env.DB.prepare(
          'UPDATE exercises SET version = version + 1, name = ?, updated_at = ? WHERE id = ?'
        ).bind(input.name, at, id)
      ])
      return c.json({ ok: true as const, exercise: await mustReadExercise(c, viewer, id) }, 200)
    }
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/library/exercises/{id}',
      tags: ['Library'],
      summary: 'Delete an exercise from the library',
      description:
        'Soft: it leaves the library and can no longer be added to a sequence, but sequences that already pin it keep playing it. Owner or admin only.',
      request: { params: idParam },
      responses: {
        200: { description: 'Deleted', content: json(DeletedResponseSchema) },
        401: unauthorized,
        403: forbidden,
        404: notFound
      }
    }),
    async c => {
      const viewer = need(c)
      const { id } = c.req.valid('param')
      const head = await exerciseHead(c.env.DB, id)
      assertEditor(viewer, head.owner_id, 'exercise')
      const at = nowIso()
      await c.env.DB.prepare(
        'UPDATE exercises SET deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ?'
      )
        .bind(at, at, id)
        .run()
      return c.json({ ok: true as const, deleted: id }, 200)
    }
  )

  // ================================================================ pictures

  app.openapi(
    createRoute({
      method: 'post',
      path: '/library/images',
      tags: ['Library'],
      summary: "Upload an exercise's picture",
      description: `The raw image is the body (PNG, JPEG, GIF, WebP or AVIF; up to ${MAX_IMAGE_BYTES} bytes). It is stored on cdn.hadoku.me, which is public: never upload anything private. ${DAILY_UPLOAD_CAP} a day per person. Returns the key to put on an exercise.`,
      request: {
        body: {
          content: { 'application/octet-stream': { schema: z.any().openapi({ format: 'binary' }) } }
        }
      },
      responses: {
        200: { description: 'Stored', content: json(ImageUploadResponseSchema) },
        401: unauthorized,
        413: domainError('Too large (UPLOAD_REFUSED)'),
        415: domainError('Not an image the CDN accepts (UPLOAD_REFUSED)'),
        429: domainError('Daily uploads used up (UPLOAD_LIMIT)'),
        502: domainError('The CDN did not answer (UPLOADS_UNAVAILABLE)'),
        503: domainError('Uploads not configured on this install (UPLOADS_UNAVAILABLE)')
      }
    }),
    async c => {
      const viewer = need(c)
      const db = c.env.DB
      const since = new Date(Date.now() - DAY_MS).toISOString()
      const used = await db
        .prepare('SELECT COUNT(*) AS n FROM library_uploads WHERE user_id = ? AND at >= ?')
        .bind(viewer.id, since)
        .first<number>('n')
      if ((used ?? 0) >= DAILY_UPLOAD_CAP) {
        throw new Refusal(
          429,
          'UPLOAD_LIMIT',
          `${DAILY_UPLOAD_CAP} pictures a day — try again tomorrow`
        )
      }
      const declared = Number(c.req.header('Content-Length') ?? '0')
      const tooBig = `Pictures can be up to ${MAX_IMAGE_BYTES / 1024 / 1024} MB`
      if (declared > MAX_IMAGE_BYTES) throw new Refusal(413, 'UPLOAD_REFUSED', tooBig)
      const bytes = await readBounded(c.req.raw.body, MAX_IMAGE_BYTES)
      if (!bytes) throw new Refusal(413, 'UPLOAD_REFUSED', tooBig)
      if (bytes.byteLength === 0) throw new Refusal(415, 'UPLOAD_REFUSED', 'Empty upload')
      const imageKey = await uploadToCdn(c.env, bytes)
      await db
        .prepare('INSERT INTO library_uploads (user_id, image_key, at) VALUES (?, ?, ?)')
        .bind(viewer.id, imageKey, nowIso())
        .run()
      return c.json(
        { ok: true as const, imageKey, imageUrl: imageUrl(c.env, imageKey) as string },
        200
      )
    }
  )

  // ================================================================ sequences

  app.openapi(
    createRoute({
      method: 'get',
      path: '/library/sequences',
      tags: ['Library'],
      summary: 'Sequences in the shared library',
      request: { query: LibraryQuerySchema },
      responses: {
        200: { description: 'Latest version of each', content: json(ListSequencesResponseSchema) },
        401: unauthorized
      }
    }),
    async c => {
      const viewer = need(c)
      const { q, mine } = c.req.valid('query')
      const sequences = await listSequences(c.env.DB, viewer, {
        q,
        ownerId: mine === '1' ? viewer.id : undefined
      })
      return c.json({ sequences }, 200)
    }
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/library/sequences',
      tags: ['Library'],
      summary: 'Make a sequence',
      description:
        "Each node pins an exercise version (default: that exercise's latest). Deleted exercises can't be added.",
      request: { body: { content: json(SequenceInputSchema) } },
      responses: {
        200: { description: 'Created at version 1', content: json(SequenceResponseSchema) },
        401: unauthorized,
        404: notFound
      }
    }),
    async c => {
      const viewer = need(c)
      const input = c.req.valid('json')
      const nodes = await resolveNodes(c.env.DB, input.nodes, new Set())
      const id = TaskUtils.generateULID()
      const at = nowIso()
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO sequences (id, owner_id, version, name, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?, ?)`
        ).bind(id, viewer.id, input.name, at, at),
        ...insertSequenceVersion(c.env.DB, id, 1, input, nodes, viewer.id, at)
      ])
      return c.json({ ok: true as const, sequence: await mustReadSequence(c, viewer, id) }, 200)
    }
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/library/sequences/{id}',
      tags: ['Library'],
      summary: 'One sequence with every node resolved',
      request: { params: idParam, query: VersionQuerySchema },
      responses: {
        200: { description: 'The sequence', content: json(SequenceResponseSchema) },
        401: unauthorized,
        404: notFound
      }
    }),
    async c => {
      const viewer = need(c)
      const { id } = c.req.valid('param')
      const { version } = c.req.valid('query')
      return c.json(
        { ok: true as const, sequence: await mustReadSequence(c, viewer, id, version) },
        200
      )
    }
  )

  app.openapi(
    createRoute({
      method: 'put',
      path: '/library/sequences/{id}',
      tags: ['Library'],
      summary: 'Edit a sequence: saves a new version',
      description:
        'Board widgets pinned to an earlier version keep it until their owner updates. Owner or admin only.',
      request: { params: idParam, body: { content: json(SequenceInputSchema) } },
      responses: {
        200: { description: 'The new version', content: json(SequenceResponseSchema) },
        401: unauthorized,
        403: forbidden,
        404: notFound
      }
    }),
    async c => {
      const viewer = need(c)
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')
      const db = c.env.DB
      const head = await sequenceHead(db, id)
      assertEditor(viewer, head.owner_id, 'sequence')
      if (head.deleted_at)
        throw new Refusal(404, 'SEQUENCE_NOT_FOUND', `Sequence ${id} was deleted`)
      const pinned = await db
        .prepare(
          `SELECT DISTINCT exercise_id || '@' || exercise_version AS k FROM sequence_nodes
            WHERE sequence_id = ?`
        )
        .bind(id)
        .all<{ k: string }>()
      const nodes = await resolveNodes(db, input.nodes, new Set(pinned.results.map(r => r.k)))
      const next = head.version + 1
      const at = nowIso()
      // The head's version guards the write: a racing save already moved it,
      // so this UPDATE changes nothing and the version rows collide on the key.
      await db.batch([
        db
          .prepare(
            'UPDATE sequences SET version = ?, name = ?, updated_at = ? WHERE id = ? AND version = ?'
          )
          .bind(next, input.name, at, id, head.version),
        ...insertSequenceVersion(db, id, next, input, nodes, viewer.id, at)
      ])
      return c.json({ ok: true as const, sequence: await mustReadSequence(c, viewer, id) }, 200)
    }
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/library/sequences/{id}',
      tags: ['Library'],
      summary: 'Delete a sequence from the library',
      description:
        'Soft: it leaves the library, and board widgets that pin it keep playing it. Owner or admin only.',
      request: { params: idParam },
      responses: {
        200: { description: 'Deleted', content: json(DeletedResponseSchema) },
        401: unauthorized,
        403: forbidden,
        404: notFound
      }
    }),
    async c => {
      const viewer = need(c)
      const { id } = c.req.valid('param')
      const head = await sequenceHead(c.env.DB, id)
      assertEditor(viewer, head.owner_id, 'sequence')
      const at = nowIso()
      await c.env.DB.prepare(
        'UPDATE sequences SET deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ?'
      )
        .bind(at, at, id)
        .run()
      return c.json({ ok: true as const, deleted: id }, 200)
    }
  )

  // ================================================================ runs

  app.openapi(
    createRoute({
      method: 'get',
      path: '/sequence-runs',
      tags: ['Library'],
      summary: "The caller's runs, newest first",
      request: { query: ListRunsQuerySchema },
      responses: {
        200: { description: 'Runs with every node play', content: json(ListRunsResponseSchema) },
        401: unauthorized
      }
    }),
    async c => {
      const viewer = need(c)
      const { sequenceId, limit } = c.req.valid('query')
      const { results } = await c.env.DB.prepare(
        `SELECT ${RUN_COLS} FROM sequence_runs
          WHERE runner_id = ? ${sequenceId ? 'AND sequence_id = ?' : ''}
          ORDER BY started_at DESC, rowid DESC LIMIT ${limit ?? 20}`
      )
        .bind(...(sequenceId ? [viewer.id, sequenceId] : [viewer.id]))
        .all<RunRow>()
      return c.json({ runs: await withRunNodes(c.env.DB, viewer, results) }, 200)
    }
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sequence-runs',
      tags: ['Library'],
      summary: 'Start a run (the first press of play)',
      request: { body: { content: json(StartRunInputSchema) } },
      responses: {
        200: { description: 'The run, active', content: json(RunResponseSchema) },
        401: unauthorized,
        403: forbidden,
        404: notFound
      }
    }),
    async c => {
      const viewer = need(c)
      const body = c.req.valid('json')
      const db = c.env.DB
      const seq = await mustReadSequence(c, viewer, body.sequenceId, body.version)
      let board: { ownerId: string; boardId: string } | null = null
      if (body.board && body.widgetId) {
        const ctx = await getBoardContext(c, body.board)
        if (!ctx || !ctx.exists) {
          throw new Refusal(404, 'BOARD_NOT_FOUND', `Board ${body.board} not found`)
        }
        if (ctx.access === 'readonly') {
          throw new Refusal(403, 'FORBIDDEN', 'Read-only access to this board')
        }
        const widget = await db
          .prepare(
            'SELECT 1 AS ok FROM board_sequences WHERE user_id = ? AND board_id = ? AND id = ?'
          )
          .bind(ctx.ownerId, ctx.boardId, body.widgetId)
          .first<{ ok: number }>()
        if (!widget) throw new Refusal(404, 'WIDGET_NOT_FOUND', `Widget ${body.widgetId} not found`)
        board = { ownerId: ctx.ownerId, boardId: ctx.boardId }
      }
      const id = TaskUtils.generateULID()
      await db
        .prepare(
          `INSERT INTO sequence_runs (id, runner_id, sequence_id, sequence_version, node_count,
             board_owner_id, board_id, widget_id, status, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
        )
        .bind(
          id,
          viewer.id,
          seq.id,
          seq.version,
          seq.nodeCount,
          board?.ownerId ?? null,
          board?.boardId ?? null,
          board ? (body.widgetId ?? null) : null,
          nowIso()
        )
        .run()
      const [run] = await withRunNodes(db, viewer, [await readRun(db, viewer, id)])
      return c.json({ ok: true as const, run }, 200)
    }
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sequence-runs/{id}/nodes',
      tags: ['Library'],
      summary: 'Log one node play',
      description:
        "Every time a node is left: `completed` (its timer ran out, or next on a manual node), `skipped` (skipped forward early), `rewound` (went back), or `stopped` (closed the player). A node played twice is two rows. The exercise is filled in from the run's pinned sequence version, not taken from the client.",
      request: { params: idParam, body: { content: json(RunNodeInputSchema) } },
      responses: {
        200: { description: 'The run so far', content: json(RunResponseSchema) },
        401: unauthorized,
        404: notFound,
        409: domainError('The run already ended (RUN_FINISHED)'),
        422: domainError("Not a node of the run's sequence (NODE_OUT_OF_RANGE)")
      }
    }),
    async c => {
      const viewer = need(c)
      const { id } = c.req.valid('param')
      const body = c.req.valid('json')
      const db = c.env.DB
      const run = await readRun(db, viewer, id)
      if (run.status !== 'active') throw new Refusal(409, 'RUN_FINISHED', 'This run already ended')
      const node = await db
        .prepare(
          `SELECT exercise_id, exercise_version FROM sequence_nodes
            WHERE sequence_id = ? AND version = ? AND position = ?`
        )
        .bind(run.sequence_id, run.sequence_version, body.position)
        .first<{ exercise_id: string; exercise_version: number }>()
      if (!node) {
        throw new Refusal(422, 'NODE_OUT_OF_RANGE', `The sequence has no node ${body.position}`)
      }
      // seq is computed in the INSERT, so two plays posted at once get 0 and 1,
      // or the second collides on the key rather than overwriting the first.
      await db
        .prepare(
          `INSERT INTO sequence_run_nodes
             (run_id, seq, position, exercise_id, exercise_version, outcome, active_ms, started_at, ended_at)
           VALUES (?, (SELECT COUNT(*) FROM sequence_run_nodes WHERE run_id = ?), ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          id,
          body.position,
          node.exercise_id,
          node.exercise_version,
          body.outcome,
          body.activeMs,
          body.startedAt,
          body.endedAt
        )
        .run()
      const [out] = await withRunNodes(db, viewer, [run])
      return c.json({ ok: true as const, run: out }, 200)
    }
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/sequence-runs/{id}/finish',
      tags: ['Library'],
      summary: 'End a run',
      description:
        '`completed` when the player reached the end, `stopped` when it was closed early. Whether every node was actually done is `complete` on the run.',
      request: { params: idParam, body: { content: json(FinishRunInputSchema) } },
      responses: {
        200: { description: 'The finished run', content: json(RunResponseSchema) },
        401: unauthorized,
        404: notFound,
        409: domainError('The run already ended (RUN_FINISHED)')
      }
    }),
    async c => {
      const viewer = need(c)
      const { id } = c.req.valid('param')
      const { status } = c.req.valid('json')
      const db = c.env.DB
      const at = nowIso()
      const res = await db
        .prepare(
          `UPDATE sequence_runs SET status = ?, ended_at = ?
            WHERE id = ? AND runner_id = ? AND status = 'active'`
        )
        .bind(status, at, id, viewer.id)
        .run()
      const run = await readRun(db, viewer, id)
      if (!res.meta.changes) throw new Refusal(409, 'RUN_FINISHED', 'This run already ended')
      const [out] = await withRunNodes(db, viewer, [run])
      return c.json({ ok: true as const, run: out }, 200)
    }
  )

  return app
}
