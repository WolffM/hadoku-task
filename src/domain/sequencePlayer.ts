/**
 * The sequence player's clock, as a pure state machine: no timers, no audio,
 * no React. The component feeds it `now` (performance.now()) on every frame
 * and acts on the events it returns: play a tick or the go sound, log a node
 * play, finish the run.
 *
 * Every node goes: COUNTDOWN (5 s, shown 5 4 3 2 1, a tick at 3, 2 and 1, the
 * go sound at 0, "Go!" instead of 0) → ACTIVE. A timed node's active phase
 * ends by itself after its seconds; a manual one waits for `next()`. Then the
 * next node's countdown starts, until the last node, which finishes the run.
 *
 * Time only runs while playing, so pausing anywhere (in a countdown or
 * mid-exercise) freezes the display and the logged `activeMs` alike.
 *
 * Every node the player LEAVES is one NodePlay event — completed, skipped
 * (moved forward early), rewound (moved back) or stopped (closed). A node never
 * entered (jumped over on the minimap) logs nothing.
 */

export const COUNTDOWN_MS = 5000
/** "Go!" stays up this long after the countdown, while the timer already runs. */
export const GO_SHOWN_MS = 900

export type NodeMode = 'timed' | 'manual'
export interface PlayerNode {
  mode: NodeMode
  /** A timed node's length. Null on a manual node. */
  seconds: number | null
}

export type NodeOutcome = 'completed' | 'skipped' | 'rewound' | 'stopped'

export interface PlayerState {
  index: number
  phase: 'countdown' | 'active' | 'done'
  playing: boolean
  /** Has play ever been pressed — the run exists from then. */
  started: boolean
  /** Time accumulated in the current phase before the last resume. */
  phaseMs: number
  /** `now` at the last resume, while playing; null when paused. */
  since: number | null
  /** Wall-clock ISO time the current node was entered (its countdown began). */
  enteredAt: string | null
  /** The lowest countdown number already beeped for this node (3, 2, 1), or 4 for none. */
  beeped: number
}

export type PlayerEvent =
  | { type: 'tick'; n: 3 | 2 | 1 }
  | { type: 'go' }
  | {
      type: 'node'
      position: number
      outcome: NodeOutcome
      activeMs: number
      startedAt: string
      endedAt: string
    }
  | { type: 'finished' }

export interface Step {
  state: PlayerState
  events: PlayerEvent[]
}

/** Wall clock for logged timestamps; injectable so the harness is deterministic. */
export type Wall = () => Date

export function initialState(): PlayerState {
  return {
    index: 0,
    phase: 'countdown',
    playing: false,
    started: false,
    phaseMs: 0,
    since: null,
    enteredAt: null,
    beeped: 4
  }
}

/** Milliseconds spent in the current phase at `now`. */
export function phaseElapsed(s: PlayerState, now: number): number {
  return s.phaseMs + (s.playing && s.since !== null ? now - s.since : 0)
}

/** What the big display shows. */
export function display(
  s: PlayerState,
  node: PlayerNode | undefined,
  now: number
):
  | { kind: 'countdown'; n: number }
  | { kind: 'go' }
  | { kind: 'timer'; remainingMs: number; progress: number }
  | { kind: 'manual'; elapsedMs: number }
  | { kind: 'done' } {
  if (s.phase === 'done' || !node) return { kind: 'done' }
  const t = phaseElapsed(s, now)
  if (s.phase === 'countdown')
    return { kind: 'countdown', n: Math.max(1, Math.ceil((COUNTDOWN_MS - t) / 1000)) }
  if (t < GO_SHOWN_MS && s.playing) return { kind: 'go' }
  if (node.mode === 'manual') return { kind: 'manual', elapsedMs: t }
  const total = (node.seconds ?? 0) * 1000
  return {
    kind: 'timer',
    remainingMs: Math.max(0, total - t),
    progress: total > 0 ? Math.min(1, t / total) : 1
  }
}

function enter(s: PlayerState, index: number, now: number, wall: Wall): PlayerState {
  return {
    ...s,
    index,
    phase: 'countdown',
    phaseMs: 0,
    since: s.playing ? now : null,
    enteredAt: s.started ? wall().toISOString() : null,
    beeped: 4
  }
}

/** Log leaving the current node, if it was entered. */
function leave(s: PlayerState, outcome: NodeOutcome, now: number, wall: Wall): PlayerEvent[] {
  if (!s.started || s.phase === 'done' || !s.enteredAt) return []
  const activeMs = s.phase === 'active' ? Math.round(phaseElapsed(s, now)) : 0
  return [
    {
      type: 'node',
      position: s.index,
      outcome,
      activeMs,
      startedAt: s.enteredAt,
      endedAt: wall().toISOString()
    }
  ]
}

/** Move from the current node to `index` (or finish past the end). */
function moveTo(
  s: PlayerState,
  nodes: readonly PlayerNode[],
  index: number,
  outcome: NodeOutcome,
  now: number,
  wall: Wall
): Step {
  const events = leave(s, outcome, now, wall)
  if (index >= nodes.length) {
    events.push({ type: 'finished' })
    return { state: { ...s, phase: 'done', playing: false, since: null }, events }
  }
  return { state: enter(s, Math.max(0, index), now, wall), events }
}

/**
 * Advance the clock to `now`: fire due beeps, end the countdown, end a timed
 * node. Loops, so a long gap (a backgrounded tab) catches up correctly.
 */
export function advance(
  s: PlayerState,
  nodes: readonly PlayerNode[],
  now: number,
  wall: Wall = () => new Date()
): Step {
  const events: PlayerEvent[] = []
  let state = s
  for (let guard = 0; guard < nodes.length * 3 + 3; guard++) {
    if (!state.playing || state.phase === 'done') break
    const node = nodes[state.index]
    if (!node) break
    const t = phaseElapsed(state, now)
    if (state.phase === 'countdown') {
      // After a gap (a backgrounded tab) only the latest due tick sounds, and
      // none once the countdown is already over: the past is not replayed.
      let due: 3 | 2 | 1 | null = null
      for (const n of [3, 2, 1] as const) {
        if (state.beeped > n && t >= COUNTDOWN_MS - n * 1000) {
          due = n
          state = { ...state, beeped: n }
        }
      }
      if (due !== null && t < COUNTDOWN_MS) events.push({ type: 'tick', n: due })
      if (t < COUNTDOWN_MS) break
      events.push({ type: 'go' })
      // The active phase starts exactly at the countdown's end, not at `now`.
      state = {
        ...state,
        phase: 'active',
        phaseMs: 0,
        since: now - (t - COUNTDOWN_MS)
      }
      continue
    }
    // active
    if (node.mode === 'manual') break
    const total = (node.seconds ?? 0) * 1000
    if (t < total) break
    const overshoot = t - total
    // Leave with exactly the node's length on the clock, paused, so the log
    // says 30 000 ms for a 30 s node however late this frame ran.
    const ended: PlayerState = { ...state, phaseMs: total, since: null, playing: false }
    const step = moveTo(ended, nodes, state.index + 1, 'completed', now, wall)
    events.push(...step.events)
    // The next countdown began when this node ended, not at `now`.
    state =
      step.state.phase === 'countdown'
        ? { ...step.state, playing: true, since: now - overshoot }
        : step.state
  }
  return { state, events }
}

export function play(s: PlayerState, now: number, wall: Wall = () => new Date()): PlayerState {
  if (s.playing || s.phase === 'done') return s
  return {
    ...s,
    playing: true,
    since: now,
    started: true,
    enteredAt: s.enteredAt ?? wall().toISOString()
  }
}

export function pause(s: PlayerState, now: number): PlayerState {
  if (!s.playing) return s
  return { ...s, playing: false, phaseMs: phaseElapsed(s, now), since: null }
}

/** Manual node: done, on to the next. Ignored until the countdown has finished. */
export function next(s: PlayerState, nodes: readonly PlayerNode[], now: number, wall?: Wall): Step {
  if (s.phase !== 'active') return { state: s, events: [] }
  return moveTo(s, nodes, s.index + 1, 'completed', now, wall ?? (() => new Date()))
}

export function skip(s: PlayerState, nodes: readonly PlayerNode[], now: number, wall?: Wall): Step {
  if (s.phase === 'done') return { state: s, events: [] }
  return moveTo(s, nodes, s.index + 1, 'skipped', now, wall ?? (() => new Date()))
}

/** Back one node; on the first node, start it over. */
export function back(s: PlayerState, nodes: readonly PlayerNode[], now: number, wall?: Wall): Step {
  if (s.phase === 'done') return { state: s, events: [] }
  return moveTo(s, nodes, Math.max(0, s.index - 1), 'rewound', now, wall ?? (() => new Date()))
}

/** A minimap tap: forward counts as skipping, back (or the same node) as rewinding. */
export function jump(
  s: PlayerState,
  nodes: readonly PlayerNode[],
  index: number,
  now: number,
  wall?: Wall
): Step {
  if (index < 0 || index >= nodes.length || s.phase === 'done') return { state: s, events: [] }
  const outcome = index > s.index ? 'skipped' : 'rewound'
  return moveTo(s, nodes, index, outcome, now, wall ?? (() => new Date()))
}

/** Closing the player mid-run. */
export function stop(s: PlayerState, now: number, wall: Wall = () => new Date()): PlayerEvent[] {
  return leave(s, 'stopped', now, wall)
}

/** Total length of a sequence, countdowns included; manual nodes count only their countdown. */
export function plannedMs(nodes: readonly PlayerNode[]): number {
  return nodes.reduce(
    (t, n) => t + COUNTDOWN_MS + (n.mode === 'timed' ? (n.seconds ?? 0) * 1000 : 0),
    0
  )
}

/** 75 → "1:15", 3600 → "1:00:00". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
