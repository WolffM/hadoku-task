/**
 * The sequence player: a popout that opens PAUSED on the first exercise and
 * waits for Play.
 *
 * Each node: a 5 s countdown (5 4 3 2 1, a tick at 3 2 1, the go sound and
 * "Go!" at 0), then the exercise — a timer that moves on by itself on a timed
 * node, or a Next button on a manual one. The timer bar sits on top of the
 * minimap, a row of one dot per node that shows where you are and jumps there
 * when tapped. Back, play/pause and skip are below.
 *
 * The clock is src/domain/sequencePlayer.ts; this component feeds it frames and
 * acts on its events. Logging never blocks playback: the run is created on the
 * first Play, and every node play is queued behind it, in order. A failed log
 * is reported once and the workout carries on.
 *
 * Closing mid-run pauses and asks first (a tap on the backdrop shouldn't end a
 * workout); stopping logs the current node as stopped and the run as stopped.
 */
import React from 'react'
import { Icon } from '@wolffm/themes'
import { Modal } from '@wolffm/task-ui-components'
import { ConfirmModal } from '../modals/ConfirmModal'
import type { SequenceApi } from '../../api/sequences'
import type { Sequence, SequenceRun } from '../../domain/sequences'
import {
  advance,
  back,
  display,
  formatDuration,
  initialState,
  jump,
  next,
  pause,
  play,
  skip,
  stop,
  type PlayerEvent,
  type PlayerState
} from '../../domain/sequencePlayer'
import { playGo, playTick, unlockAudio } from './beeps'

export interface SequencePlayerProps {
  sequence: Sequence
  api: SequenceApi
  /** Started from a board widget: the run is logged against it. */
  board?: { ref: string; widgetId: string }
  onError: (message: string) => void
  /** A run ended (completed or stopped) and its log is written. */
  onRunEnded?: (run: SequenceRun) => void
  onClose: () => void
}

type WakeLock = { release(): Promise<void> }

export function SequencePlayer({
  sequence,
  api,
  board,
  onError,
  onRunEnded,
  onClose
}: SequencePlayerProps) {
  const nodes = sequence.nodes
  const stateRef = React.useRef<PlayerState>(initialState())
  const [, setFrame] = React.useState(0)
  const rerender = () => setFrame(f => f + 1)
  const [confirmStop, setConfirmStop] = React.useState(false)
  // Which positions have a completed play this run, for the summary and the minimap.
  const [completed, setCompleted] = React.useState<ReadonlySet<number>>(new Set())
  const [skipped, setSkipped] = React.useState<ReadonlySet<number>>(new Set())
  // Sounds played, newest last — on the DOM for the e2e spec to read.
  const [sounds, setSounds] = React.useState<string[]>([])

  // ---- the run log: one promise chain, so plays land in order ----------------
  const runRef = React.useRef<Promise<string | null> | null>(null)
  const chainRef = React.useRef<Promise<unknown>>(Promise.resolve())
  const reportedRef = React.useRef(false)
  const report = React.useCallback(
    (err: unknown) => {
      if (reportedRef.current) return
      reportedRef.current = true
      onError(`This workout isn't being logged: ${(err as Error).message}`)
    },
    [onError]
  )
  const enqueue = React.useCallback(
    (work: (runId: string) => Promise<unknown>) => {
      const run = runRef.current
      if (!run) return
      chainRef.current = chainRef.current.then(async () => {
        const id = await run
        if (!id) return
        try {
          await work(id)
        } catch (err) {
          report(err)
        }
      })
    },
    [report]
  )
  const beginRun = React.useCallback(() => {
    runRef.current = api
      .startRun({
        sequenceId: sequence.id,
        version: sequence.version,
        ...(board ? { board: board.ref, widgetId: board.widgetId } : {})
      })
      .then(
        r => r.id,
        err => {
          report(err)
          return null
        }
      )
  }, [api, board, report, sequence.id, sequence.version])

  // NOT `onRunEnded?.(await api.finishRun(…))`: an optional call skips
  // evaluating its arguments when the callee is absent, so the run would never
  // be finished wherever no one listens (the library's player).
  const endRun = React.useCallback(
    async (id: string, status: 'completed' | 'stopped') => {
      const run = await api.finishRun(id, status)
      onRunEnded?.(run)
    },
    [api, onRunEnded]
  )

  const handle = React.useCallback(
    (events: PlayerEvent[]) => {
      for (const e of events) {
        if (e.type === 'tick') {
          playTick()
          setSounds(s => [...s, `tick${e.n}`])
        } else if (e.type === 'go') {
          playGo()
          setSounds(s => [...s, 'go'])
        } else if (e.type === 'node') {
          const { type: _type, ...play } = e
          if (e.outcome === 'completed') setCompleted(s => new Set(s).add(e.position))
          if (e.outcome === 'skipped') setSkipped(s => new Set(s).add(e.position))
          enqueue(id => api.logNode(id, play))
        } else if (e.type === 'finished') {
          enqueue(id => endRun(id, 'completed'))
        }
      }
    },
    [api, enqueue, endRun]
  )

  const apply = (step: { state: PlayerState; events: PlayerEvent[] }) => {
    stateRef.current = step.state
    handle(step.events)
    rerender()
  }

  // ---- the frame loop, while playing ------------------------------------------
  const playing = stateRef.current.playing
  React.useEffect(() => {
    if (!playing) return
    let raf = 0
    const frame = () => {
      const step = advance(stateRef.current, nodes, performance.now())
      stateRef.current = step.state
      if (step.events.length) handle(step.events)
      rerender()
      if (step.state.playing) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    // A backgrounded tab gets no frames; a timer keeps the clock (and the
    // beeps) moving at a coarser grain until it is visible again.
    const fallback = window.setInterval(() => {
      if (document.visibilityState === 'hidden') frame()
    }, 250)
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(fallback)
    }
  }, [playing, nodes, handle])

  // ---- keep the screen awake while playing ------------------------------------
  React.useEffect(() => {
    if (!playing) return
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<WakeLock> }
    }
    let lock: WakeLock | null = null
    let cancelled = false
    nav.wakeLock?.request('screen').then(
      l => {
        if (cancelled) void l.release()
        else lock = l
      },
      // Refused (battery saver, an unfocused tab): the workout still plays.
      () => undefined
    )
    return () => {
      cancelled = true
      void lock?.release()
    }
  }, [playing])

  // ---- controls ------------------------------------------------------------------
  const s = stateRef.current
  const now = performance.now()
  const node = nodes[s.index]
  const shown = display(s, node, now)

  const onPlay = () => {
    unlockAudio()
    if (s.phase === 'done') {
      // Play again: a fresh run from the top.
      stateRef.current = initialState()
      runRef.current = null
      reportedRef.current = false
      setCompleted(new Set())
      setSkipped(new Set())
    }
    if (!runRef.current) beginRun()
    stateRef.current = play(stateRef.current, performance.now())
    rerender()
  }
  const onPause = () => {
    stateRef.current = pause(s, performance.now())
    rerender()
  }
  const t = () => performance.now()

  const finishStopped = () => {
    const st = stateRef.current
    if (st.started && st.phase !== 'done') {
      handle(stop(st, t()))
      enqueue(id => endRun(id, 'stopped'))
    }
  }
  const requestClose = () => {
    const st = stateRef.current
    if (st.started && st.phase !== 'done') {
      stateRef.current = pause(st, t())
      setConfirmStop(true)
      rerender()
      return
    }
    onClose()
  }

  const upNext = nodes[s.index + 1]
  const barProgress =
    shown.kind === 'timer'
      ? shown.progress
      : shown.kind === 'countdown'
        ? Math.min(1, (5 - shown.n + 1) / 5)
        : shown.kind === 'done'
          ? 1
          : 0
  const barKind =
    s.phase === 'countdown' ? 'countdown' : node?.mode === 'manual' ? 'manual' : 'timer'

  return (
    <Modal
      isOpen
      title={sequence.name}
      onClose={requestClose}
      className="sequence-player"
      actions={
        <div className="modal-actions">
          <button type="button" className="sequence-btn" onClick={requestClose}>
            Close
          </button>
        </div>
      }
    >
      <div
        className="sequence-player__stage"
        data-testid="sequence-player"
        data-phase={s.phase}
        data-index={s.index}
        data-playing={s.playing ? 'true' : 'false'}
        data-sounds={sounds.join(' ')}
      >
        {shown.kind === 'done' ? (
          <div className="sequence-player__done" data-testid="sequence-done">
            <Icon name="trophy" size={48} />
            <h3>Done!</h3>
            <p>
              {completed.size} of {nodes.length} exercises completed
              {skipped.size > 0 && ` · ${skipped.size} skipped`}
            </p>
          </div>
        ) : (
          <>
            <div className="sequence-player__media">
              {node?.exercise.imageUrl ? (
                <img src={node.exercise.imageUrl} alt={node.exercise.name} />
              ) : (
                <Icon name="image" size={48} className="sequence-player__placeholder" />
              )}
            </div>
            <div className="sequence-player__exercise">
              <span className="sequence-player__step">
                {s.index + 1} / {nodes.length}
              </span>
              <h3 className="sequence-player__name" data-testid="sequence-exercise">
                {node?.exercise.name}
              </h3>
              {node?.exercise.description && (
                <p className="sequence-player__desc">{node.exercise.description}</p>
              )}
            </div>
            <div
              className={`sequence-player__clock sequence-player__clock--${shown.kind}`}
              data-testid="sequence-clock"
              aria-live="polite"
            >
              {!s.started ? (
                <span className="sequence-player__hint">Press play to start</span>
              ) : shown.kind === 'countdown' ? (
                shown.n
              ) : shown.kind === 'go' ? (
                'Go!'
              ) : shown.kind === 'timer' ? (
                formatDuration(Math.ceil(shown.remainingMs / 1000))
              ) : (
                formatDuration(Math.floor(shown.elapsedMs / 1000))
              )}
            </div>
            {shown.kind === 'manual' || (shown.kind === 'go' && node?.mode === 'manual') ? (
              <button
                type="button"
                className="sequence-btn sequence-btn--primary sequence-player__next"
                onClick={() => apply(next(stateRef.current, nodes, t()))}
              >
                <Icon name="check" /> Done — next
              </button>
            ) : null}
          </>
        )}

        <div
          className={`sequence-player__bar sequence-player__bar--${barKind}`}
          role="progressbar"
          aria-label="This exercise"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(barProgress * 100)}
          data-testid="sequence-bar"
        >
          <div
            className="sequence-player__bar-fill"
            style={{ transform: `scaleX(${barProgress})` }}
          />
        </div>
        <ol
          className="sequence-player__minimap"
          aria-label="Exercises"
          data-testid="sequence-minimap"
        >
          {nodes.map((n, i) => {
            const state =
              s.phase !== 'done' && i === s.index
                ? 'current'
                : completed.has(i)
                  ? 'done'
                  : skipped.has(i)
                    ? 'skipped'
                    : 'upcoming'
            return (
              <li key={i}>
                <button
                  type="button"
                  className={`sequence-dot sequence-dot--${state}`}
                  aria-label={`${i + 1}. ${n.exercise.name}`}
                  aria-current={state === 'current' ? 'step' : undefined}
                  title={n.exercise.name}
                  disabled={s.phase === 'done'}
                  onClick={() => apply(jump(stateRef.current, nodes, i, t()))}
                />
              </li>
            )
          })}
        </ol>

        {shown.kind !== 'done' && upNext && (
          <div className="sequence-player__upnext">Up next: {upNext.exercise.name}</div>
        )}

        <div className="sequence-player__controls">
          <button
            type="button"
            className="sequence-btn sequence-btn--round"
            aria-label="Back"
            disabled={s.phase === 'done'}
            onClick={() => apply(back(stateRef.current, nodes, t()))}
          >
            <Icon name="previous" />
          </button>
          {s.playing ? (
            <button
              type="button"
              className="sequence-btn sequence-btn--round sequence-btn--big"
              aria-label="Pause"
              onClick={onPause}
            >
              <Icon name="pause" size={28} />
            </button>
          ) : (
            <button
              type="button"
              className="sequence-btn sequence-btn--round sequence-btn--big sequence-btn--primary"
              aria-label={s.phase === 'done' ? 'Play again' : 'Play'}
              onClick={onPlay}
            >
              <Icon name={s.phase === 'done' ? 'refresh' : 'play'} size={28} />
            </button>
          )}
          <button
            type="button"
            className="sequence-btn sequence-btn--round"
            aria-label="Skip"
            disabled={s.phase === 'done'}
            onClick={() => apply(skip(stateRef.current, nodes, t()))}
          >
            <Icon name="next" />
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmStop}
        title="Stop this workout?"
        message="What you've done so far is logged."
        confirmLabel="Stop"
        onCancel={() => setConfirmStop(false)}
        onConfirm={() => {
          setConfirmStop(false)
          finishStopped()
          onClose()
        }}
      />
    </Modal>
  )
}
