/**
 * The shared vocabulary of the automation harness: the actors, the lane shape,
 * the union of every response body the scenarios read, and the context object
 * that carries the harness's HTTP/MCP helpers into them.
 *
 * automation-verify.ts owns the wiring (D1, KV, the fetch stub, the pass/fail
 * counters) and builds a Ctx from it; the scenario modules only drive it. That
 * split is what lets 15 sections live outside a single 1030-line `main` without
 * any of them reaching for a module-level global.
 */

export interface User {
  key: string
  id: string
}

export const OWNER: User = { key: 'owner-key', id: 'owner-uid' }
export const CONTRIB: User = { key: 'contrib-key', id: 'contrib-uid' }
export const RUNNER: User = { key: 'tenhands-key', id: 'tenhands-uid' }
export const AGGREGATOR: User = { key: 'aggregator-key', id: 'aggregator-uid' }

export interface Lane {
  tag: string
  label: string
  order: number
  editableBy: 'user' | 'agent'
  [k: string]: unknown
}
export interface Body {
  tasks?: Array<{ id: string; tag?: string | null; metadata?: Record<string, unknown> | null }>
  boards?: Array<{
    id: string
    mode?: string
    lanes?: Lane[] | null
    tags?: string[]
    handle?: string
    // reconcile report rows reuse this field with a different shape
    boardId?: string
    ownerId?: string
    grants?: Array<{
      kind: string
      name: string
      outcome: string
      previousLevel?: string
      reason?: string
    }>
  }>
  preview?: {
    digest: string
    toInbox: number
    mapping: Array<{ tag: string; count: number; lands: string }>
    collisions: string[]
  }
  applied?: { mode: string; laneCount: number; tasksToInbox: number }
  ok?: boolean
  token?: string
  mode?: string
  restoredTags?: string[]
  automationRunnerShare?: {
    granted: boolean
    name: string
    granteeUserId?: string
    reason?: string
  }
  repoServiceKeyShare?: { granted: boolean; name: string; reason?: string }
  dryRun?: boolean
  allOwners?: boolean
  summary?: {
    boardsScanned: number
    boardsWithWork: number
    granted: number
    escalated: number
    alreadyShared: number
    skipped: number
  }
  serviceKeyShare?: { granted: boolean; name: string; granteeUserId?: string; reason?: string }
  repo?: string | null
  shares?: Array<{ granteeUserId: string; level: string; name: string | null }>
  code?: string
  error?: string
  structuredContent?: { boards?: Array<{ id: string; mode?: string; lanes?: Lane[] }> }
  isError?: boolean
  content?: { text: string }[]
}

export const LANES: Lane[] = [
  { tag: 'needs-plan', label: 'Needs Plan', order: 1, editableBy: 'user' },
  { tag: 'working', label: 'Working', order: 2, editableBy: 'agent', tenhandsStage: 4 },
  { tag: 'review', label: 'Review', order: 3, editableBy: 'user' }
]

import type { FakeD1 } from '../lib/d1-sqlite'

export type Res = { status: number; json: Body | null }

/**
 * A board's currently-linked repo, read back over the API.
 *
 * Shared because both halves assert on it: the core flow proves POST
 * /boards/{ref}/repo writes and clears it, and the share flows prove linking a
 * repo is what grants that repo's service key.
 */
export const repoOfVia =
  (ctx: Pick<Ctx, 'req'>) =>
  async (id: string): Promise<string | null | undefined> =>
    (await ctx.req(OWNER, 'GET', '/task/api/boards')).json?.boards?.find(b => b.id === id)?.repo

/** Everything a scenario needs from the harness, and nothing else. */
export interface Ctx {
  req: (user: User, method: string, path: string, body?: unknown) => Promise<Res>
  /** Same as `req`, but stamps a specific tier — edge-router sets this in prod. */
  reqTier: (user: User, tier: string, method: string, path: string, body?: unknown) => Promise<Res>
  mcp: (user: User, tool: string, toolArgs?: Record<string, unknown>) => Promise<Body>
  check: (name: string, cond: boolean, detail?: string) => void
  section: (title: string) => void
  tasks: (user: User, board: string) => Promise<NonNullable<Body['tasks']>>
  /** The worker's bindings. Section 12 flips AUTOMATION_RUNNER_KEY_NAME to
   *  prove the auto-share degrades rather than throwing when it cannot
   *  resolve the runner. */
  env: Record<string, unknown>
  /** Raw SQLite handle. The reconcile sections seed rows in the pre-auto-grant
   *  shape, which no current code path can produce through the API. */
  d1: FakeD1
}
