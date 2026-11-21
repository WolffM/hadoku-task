/**
 * The sequence player's clock (src/domain/sequencePlayer.ts), driven frame by
 * frame with a fake clock. The UI end is e2e/sequences.spec.ts; what is here is
 * the timing, which a browser test can only sample:
 *
 *   - the countdown shows 5 4 3 2 1 then "Go!", never 0, ticks at 3 2 1 only,
 *     and the go sound fires once at 0
 *   - a timed node ends itself after exactly its seconds and logs exactly that
 *   - a manual node waits for next(), and next() during the countdown is ignored
 *   - pause freezes everything, including the logged active time
 *   - skip / back / minimap jumps log skipped / rewound, a repeat is a second
 *     play, and a node jumped over logs nothing
 *   - a long gap (backgrounded tab) catches up without replaying old beeps
 */
import {
  COUNTDOWN_MS,
  advance,
  back,
  display,
  formatDuration,
  initialState,
  jump,
  next,
  pause,
  play,
  plannedMs,
  skip,
  stop,
  type PlayerEvent,
  type PlayerNode,
  type PlayerState
} from '../domain/sequencePlayer'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail: unknown = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
  }
}
const section = (t: string) => console.log(`\n${t}`)

const NODES: PlayerNode[] = [
  { mode: 'timed', seconds: 10 },
  { mode: 'manual', seconds: null },
  { mode: 'timed', seconds: 3 }
]
const wall = () => new Date(1_700_000_000_000 + now)
let now = 0

/** Run the clock from `now` to `until` in 16 ms frames, collecting events. */
function runTo(s: PlayerState, until: number, nodes = NODES) {
  const events: PlayerEvent[] = []
  const shown: string[] = []
  let state = s
  while (now < until) {
    now = Math.min(until, now + 16)
    const step = advance(state, nodes, now, wall)
    state = step.state
    events.push(...step.events)
    const d = display(state, nodes[state.index], now)
    const label = d.kind === 'countdown' ? String(d.n) : d.kind
    if (shown.at(-1) !== label) shown.push(label)
  }
  return { state, events, shown }
}
const kinds = (es: PlayerEvent[]) =>
  es.map(e =>
    e.type === 'tick' ? `tick${e.n}` : e.type === 'node' ? `node${e.position}:${e.outcome}` : e.type
  )

function main() {
  section('1. Countdown and go')
  let s = initialState()
  const idle = runTo(s, 2000)
  check(
    'nothing runs until play is pressed',
    idle.events.length === 0 && idle.shown.join() === '5',
    idle
  )
  check('…and nothing has started', !idle.state.started)
  s = play(idle.state, now, wall)
  const t0 = now
  const cd = runTo(s, t0 + COUNTDOWN_MS + 500)
  check(
    'the display reads 5 4 3 2 1 Go! and never 0',
    cd.shown.join(' ') === '5 4 3 2 1 go',
    cd.shown
  )
  check(
    'ticks at 3, 2, 1 then the go sound, once each',
    kinds(cd.events).join(' ') === 'tick3 tick2 tick1 go',
    kinds(cd.events)
  )
  check('the timed node is now running', cd.state.phase === 'active' && cd.state.index === 0)

  section('2. A timed node ends itself')
  const timed = runTo(cd.state, t0 + COUNTDOWN_MS + 10_000 + 40)
  const end = timed.events.find(e => e.type === 'node')
  check(
    'after exactly its 10 s it logs completed with 10 000 ms',
    end?.type === 'node' &&
      end.outcome === 'completed' &&
      end.activeMs === 10_000 &&
      end.position === 0,
    end
  )
  check(
    '…and the next node is counting down',
    timed.state.index === 1 && timed.state.phase === 'countdown'
  )
  check(
    '…and its countdown started when the node ended, not a frame later',
    Math.abs(timed.state.phaseMs + (now - (timed.state.since ?? now)) - 40) <= 1,
    timed.state
  )

  section('3. A manual node waits for next')
  const early = next(timed.state, NODES, now, wall)
  check(
    'next() during the countdown does nothing',
    early.state === timed.state && early.events.length === 0
  )
  const manual = runTo(timed.state, now + COUNTDOWN_MS + 20_000)
  check(
    'it never ends by itself',
    manual.state.index === 1 && manual.state.phase === 'active',
    manual.state
  )
  check('…and shows time counting up', display(manual.state, NODES[1], now).kind === 'manual')
  const done1 = next(manual.state, NODES, now, wall)
  const logged = done1.events[0]
  check(
    'next() logs it completed with its active time',
    logged?.type === 'node' &&
      logged.outcome === 'completed' &&
      Math.abs(logged.activeMs - 20_000) < 50,
    logged
  )

  section('4. Pause freezes everything')
  const third = runTo(done1.state, now + COUNTDOWN_MS + 1000)
  const paused = pause(third.state, now)
  const frozen = runTo(paused, now + 60_000)
  check(
    'a minute paused changes nothing',
    frozen.events.length === 0 && frozen.state.phaseMs === paused.phaseMs
  )
  const resumed = runTo(play(frozen.state, now, wall), now + 2100)
  const last = resumed.events.find(e => e.type === 'node')
  check(
    'resumed, the 3 s node logs 3 000 ms — the pause not counted',
    last?.type === 'node' && last.activeMs === 3000,
    resumed.events
  )
  check(
    '…and the last node finishes the run',
    kinds(resumed.events).at(-1) === 'finished' && resumed.state.phase === 'done'
  )

  section('5. Skip, back, jump')
  now = 0
  let p = play(initialState(), now, wall)
  p = runTo(p, now + COUNTDOWN_MS + 2000).state
  const sk = skip(p, NODES, now, wall)
  check(
    'skip logs the node skipped, with the time spent',
    sk.events[0]?.type === 'node' &&
      sk.events[0].outcome === 'skipped' &&
      sk.events[0].activeMs === 2000,
    sk.events
  )
  check('…and moves on, still playing', sk.state.index === 1 && sk.state.playing)
  const bk = back(sk.state, NODES, now, wall)
  check(
    'back from a countdown logs rewound with no active time',
    bk.events[0]?.type === 'node' &&
      bk.events[0].outcome === 'rewound' &&
      bk.events[0].activeMs === 0,
    bk.events
  )
  check('…and returns to node 0', bk.state.index === 0 && bk.state.phase === 'countdown')
  const first = back(bk.state, NODES, now, wall)
  check(
    'back on the first node starts it over',
    first.state.index === 0 && first.events[0]?.type === 'node'
  )
  const jp = jump(first.state, NODES, 2, now, wall)
  check(
    'a forward jump logs the current node skipped',
    jp.events.length === 1 && jp.events[0].type === 'node' && jp.events[0].outcome === 'skipped'
  )
  check(
    '…and nothing for node 1, never entered',
    !jp.events.some(e => e.type === 'node' && e.position === 1)
  )
  const stopped = stop(jp.state, now, wall)
  check(
    'closing logs the current node stopped',
    stopped[0]?.type === 'node' && stopped[0].outcome === 'stopped' && stopped[0].position === 2
  )
  const fresh = stop(initialState(), 0, wall)
  check('closing before play logs nothing', fresh.length === 0)

  section('6. A long gap catches up')
  now = 0
  let g = play(initialState(), now, wall)
  g = runTo(g, 1000).state
  now = 3500 // a background tab: no frames for 2.5 s
  const gap = advance(g, NODES, now, wall)
  check(
    'only the latest due tick sounds',
    kinds(gap.events).join(' ') === 'tick2',
    kinds(gap.events)
  )
  now = 60_000
  const big = advance(gap.state, NODES, now, wall)
  check(
    'a minute away: countdown, node 0 completed, into node 1 — no stale ticks',
    kinds(big.events).join(' ') === 'go node0:completed go' &&
      big.state.index === 1 &&
      big.state.phase === 'active',
    kinds(big.events)
  )

  section('7. Helpers')
  check(
    'planned length counts countdowns and timed seconds',
    plannedMs(NODES) === 3 * 5000 + 13_000
  )
  check(
    'formatDuration',
    formatDuration(75) === '1:15' &&
      formatDuration(3600) === '1:00:00' &&
      formatDuration(5) === '0:05'
  )

  console.log(`\n${pass} passed, ${fail} failed`)
  // Throw rather than process.exit: src/ is a browser program with no node types,
  // and an uncaught throw exits the runner's child process non-zero just the same.
  if (fail > 0) throw new Error(`${fail} check(s) failed`)
}

main()
