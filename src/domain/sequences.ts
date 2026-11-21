/**
 * Exercise sequences: the shared exercise library, sequence widgets on a
 * board, and the run log. The server is the only store
 * (worker/src/routes/library.ts, sequences.ts); there is no localStorage mirror.
 *
 * On the eager path (App imports the tier checks), so keep it to types and
 * predicates. Display helpers live in sequencePlayer.ts, which only the lazy
 * chunks import.
 */
import { tierAtLeast } from '@wolffm/worker-utils/auth'

export type NodeMode = 'timed' | 'manual'
export type RunStatus = 'active' | 'completed' | 'stopped'
export type NodeOutcome = 'completed' | 'skipped' | 'rewound' | 'stopped'

export interface Exercise {
  id: string
  version: number
  latestVersion: number
  name: string
  description: string | null
  imageKey: string | null
  imageUrl: string | null
  ownerId: string
  mine: boolean
  canEdit: boolean
  deleted: boolean
  createdAt: string
  updatedAt: string
}

export interface SequenceNode {
  position: number
  mode: NodeMode
  seconds: number | null
  exercise: Exercise
}

export interface SequenceSummary {
  id: string
  version: number
  latestVersion: number
  name: string
  description: string | null
  ownerId: string
  mine: boolean
  canEdit: boolean
  deleted: boolean
  nodeCount: number
  timedSeconds: number
  manualCount: number
  createdAt: string
  updatedAt: string
}

export interface Sequence extends SequenceSummary {
  nodes: SequenceNode[]
}

export interface SequenceNodeInput {
  exerciseId: string
  exerciseVersion?: number
  mode: NodeMode
  seconds?: number | null
}

export interface RunNode {
  seq: number
  position: number
  exerciseId: string
  exerciseVersion: number
  outcome: NodeOutcome
  activeMs: number
  startedAt: string
  endedAt: string
}

export interface SequenceRun {
  id: string
  runnerId: string
  mine: boolean
  sequenceId: string
  sequenceVersion: number
  nodeCount: number
  widgetId: string | null
  status: RunStatus
  complete: boolean
  startedAt: string
  endedAt: string | null
  nodes: RunNode[]
}

export interface SequenceWidget {
  id: string
  position: number
  sequence: Sequence
  createdAt: string
  updatedAt: string
}

export interface SequenceBoardData {
  canWrite: boolean
  widgets: SequenceWidget[]
  runs: SequenceRun[]
}

/**
 * The library (browse, build, play from it) is guest tier and up: the
 * worker's own predicate (viewerOf in worker/src/routes/library-store.ts).
 * Takes the HOST's tier — the app runs a guest as `public` for board storage
 * (entry.tsx), which says nothing about the library.
 */
export function canUseLibrary(accountTier: string | undefined): boolean {
  return tierAtLeast({ userType: accountTier }, 'guest')
}

/**
 * A sequence widget lives on a board, and boards are stored for member tier
 * and up (worker/src/storage-access.ts), so that is where widgets start.
 */
export function canUseSequenceWidgets(userType: string | undefined): boolean {
  return tierAtLeast({ userType }, 'member')
}
