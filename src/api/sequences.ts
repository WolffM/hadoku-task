/**
 * Exercise library, sequence widgets and runs. Direct server calls, no
 * localStorage mirror: the worker is the only store, so every call is awaited
 * and a refusal throws a SequenceApiError carrying the server's own message
 * for the caller to toast.
 */
import type {
  Exercise,
  NodeOutcome,
  Sequence,
  SequenceBoardData,
  SequenceNodeInput,
  SequenceRun,
  SequenceSummary,
  SequenceWidget
} from '../domain/sequences'
import { adminHeaders } from './client-context'

export class SequenceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
    this.name = 'SequenceApiError'
  }
}

export interface ExerciseInput {
  name: string
  description?: string | null
  imageKey?: string | null
}
export interface SequenceInput {
  name: string
  description?: string | null
  nodes: SequenceNodeInput[]
}
export interface LibraryQuery {
  q?: string
  mine?: boolean
}

export interface SequenceApi {
  listExercises(query?: LibraryQuery): Promise<Exercise[]>
  getExercise(id: string, version?: number): Promise<Exercise>
  createExercise(input: ExerciseInput): Promise<Exercise>
  updateExercise(id: string, input: ExerciseInput): Promise<Exercise>
  deleteExercise(id: string): Promise<void>
  uploadImage(file: Blob): Promise<{ imageKey: string; imageUrl: string }>

  listSequences(query?: LibraryQuery): Promise<SequenceSummary[]>
  getSequence(id: string, version?: number): Promise<Sequence>
  createSequence(input: SequenceInput): Promise<Sequence>
  updateSequence(id: string, input: SequenceInput): Promise<Sequence>
  deleteSequence(id: string): Promise<void>

  listWidgets(boardRef: string): Promise<SequenceBoardData>
  addWidget(boardRef: string, sequenceId: string, version?: number): Promise<SequenceWidget>
  repinWidget(boardRef: string, widgetId: string, version: number): Promise<SequenceWidget>
  removeWidget(boardRef: string, widgetId: string): Promise<void>

  startRun(input: {
    sequenceId: string
    version: number
    board?: string
    widgetId?: string
  }): Promise<SequenceRun>
  logNode(
    runId: string,
    play: {
      position: number
      outcome: NodeOutcome
      activeMs: number
      startedAt: string
      endedAt: string
    }
  ): Promise<SequenceRun>
  finishRun(runId: string, status: 'completed' | 'stopped'): Promise<SequenceRun>
  listRuns(query?: { sequenceId?: string; limit?: number }): Promise<SequenceRun[]>
}

export function createSequenceApi(sessionId: string): SequenceApi {
  async function call<T>(method: string, path: string, body?: unknown, raw?: Blob): Promise<T> {
    let res: Response
    try {
      res = await fetch(`/task/api${path}`, {
        method,
        headers: raw
          ? { ...adminHeaders(sessionId), 'Content-Type': 'application/octet-stream' }
          : adminHeaders(sessionId),
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body))
      })
    } catch {
      throw new SequenceApiError('Network error — nothing was saved', 0)
    }
    const data = (await res.json().catch(() => ({}))) as {
      error?: string | { message?: string }
      code?: string
      message?: string
    }
    if (!res.ok) {
      const msg = typeof data.error === 'string' ? data.error : data.error?.message
      throw new SequenceApiError(msg || `Request failed (${res.status})`, res.status, data.code)
    }
    return data as T
  }

  const seg = encodeURIComponent
  const qs = (q: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v))
    const s = p.toString()
    return s ? `?${s}` : ''
  }
  const libQuery = (q?: LibraryQuery) => qs({ q: q?.q, mine: q?.mine ? '1' : undefined })
  const widgets = (ref: string, rest = '') => `/boards/${seg(ref)}/sequences${rest}`

  return {
    async listExercises(q) {
      return (await call<{ exercises: Exercise[] }>('GET', `/library/exercises${libQuery(q)}`))
        .exercises
    },
    async getExercise(id, version) {
      return (
        await call<{ exercise: Exercise }>('GET', `/library/exercises/${seg(id)}${qs({ version })}`)
      ).exercise
    },
    async createExercise(input) {
      return (await call<{ exercise: Exercise }>('POST', '/library/exercises', input)).exercise
    },
    async updateExercise(id, input) {
      return (await call<{ exercise: Exercise }>('PUT', `/library/exercises/${seg(id)}`, input))
        .exercise
    },
    async deleteExercise(id) {
      await call('DELETE', `/library/exercises/${seg(id)}`)
    },
    async uploadImage(file) {
      return call<{ imageKey: string; imageUrl: string }>(
        'POST',
        '/library/images',
        undefined,
        file
      )
    },

    async listSequences(q) {
      return (
        await call<{ sequences: SequenceSummary[] }>('GET', `/library/sequences${libQuery(q)}`)
      ).sequences
    },
    async getSequence(id, version) {
      return (
        await call<{ sequence: Sequence }>('GET', `/library/sequences/${seg(id)}${qs({ version })}`)
      ).sequence
    },
    async createSequence(input) {
      return (await call<{ sequence: Sequence }>('POST', '/library/sequences', input)).sequence
    },
    async updateSequence(id, input) {
      return (await call<{ sequence: Sequence }>('PUT', `/library/sequences/${seg(id)}`, input))
        .sequence
    },
    async deleteSequence(id) {
      await call('DELETE', `/library/sequences/${seg(id)}`)
    },

    async listWidgets(ref) {
      return call<SequenceBoardData>('GET', widgets(ref))
    },
    async addWidget(ref, sequenceId, version) {
      return (await call<{ widget: SequenceWidget }>('POST', widgets(ref), { sequenceId, version }))
        .widget
    },
    async repinWidget(ref, widgetId, version) {
      return (
        await call<{ widget: SequenceWidget }>('PATCH', widgets(ref, `/${seg(widgetId)}`), {
          version
        })
      ).widget
    },
    async removeWidget(ref, widgetId) {
      await call('DELETE', widgets(ref, `/${seg(widgetId)}`))
    },

    async startRun(input) {
      return (await call<{ run: SequenceRun }>('POST', '/sequence-runs', input)).run
    },
    async logNode(runId, play) {
      return (await call<{ run: SequenceRun }>('POST', `/sequence-runs/${seg(runId)}/nodes`, play))
        .run
    },
    async finishRun(runId, status) {
      return (
        await call<{ run: SequenceRun }>('POST', `/sequence-runs/${seg(runId)}/finish`, { status })
      ).run
    },
    async listRuns(q) {
      return (
        await call<{ runs: SequenceRun[] }>(
          'GET',
          `/sequence-runs${qs({ sequenceId: q?.sequenceId, limit: q?.limit })}`
        )
      ).runs
    }
  }
}
