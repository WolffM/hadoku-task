/**
 * The shared vocabulary of the agent claim-protocol harness.
 *
 * agent-claim-verify.ts owns the wiring — D1, KV, the worker instance, the
 * pass/fail counters — and hands the scenarios a Ctx. Splitting 19 sections out
 * of one 607-line `main` is only safe because they communicate through the
 * worker's persisted state rather than through JavaScript locals.
 */

export interface Body {
  token?: string
  expiresAt?: string
  agentId?: string
  lane?: string | null
  ok?: boolean
  released?: boolean
  code?: string
  error?: string
  holder?: string
  tasks?: Array<{ id: string; tag?: string | null; notes?: string | null; state?: string }>
  history?: Array<{ agentId: string; endedBy: string | null; outcome: string | null }>
  changes?: Array<{ id: string; state: string; tag: string | null }>
  cursor?: string | null
  structuredContent?: {
    token?: string
    code?: string
    released?: boolean
    changes?: unknown[]
    cursor?: string | null
    boards?: Array<{ id: string }>
    count?: number
    total?: number
    nextOffset?: number | null
  }
  isError?: boolean
  content?: { text: string }[]
}

export const LANES = [
  { tag: 'needs-work', label: 'Needs Work', order: 1, editableBy: 'user' },
  { tag: 'working', label: 'Working', order: 2, editableBy: 'agent' },
  { tag: 'review', label: 'Review', order: 3, editableBy: 'user' },
  { tag: 'done', label: 'Done', order: 4, editableBy: 'agent' }
]

export type Res = { status: number; json: Body | null }

/** Everything a scenario needs from the harness, and nothing else. */
export interface Ctx {
  req: (method: string, path: string, body?: unknown) => Promise<Res>
  mcp: (tool: string, args?: Record<string, unknown>) => Promise<Body>
  check: (name: string, cond: boolean, detail?: string) => void
  section: (title: string) => void
  /** A task's current tag, read back over the API. */
  tag: (taskId: string) => Promise<string | null | undefined>
  /** Backdate a lease in D1 so expiry can be asserted without waiting it out. */
  forceExpire: (taskId: string) => void
  /** The worker itself, for the one section that must set its own tier header. */
  app: { request: (url: string, init: RequestInit, env: unknown) => Promise<Response> }
  env: Record<string, unknown>
  EDGE_SECRET: string
}
