/**
 * A sequence widget as a tile in a board's widget strip, beside the trackers.
 * Same shape as TrackerTile: the tile's own button is the frequent thing —
 * here Play, which opens the player paused — and anywhere else opens the
 * widget's detail (its runs, update, remove).
 *
 * The open target is a real <button> layered under the content and the play
 * button sits above it: two sibling buttons, never one nested in the other.
 */
import { Icon } from '@wolffm/themes'
import type { SequenceRun, SequenceWidget } from '../../domain/sequences'

export interface SequenceTileProps {
  widget: SequenceWidget
  /** This widget's runs, newest first. */
  runs: SequenceRun[]
  now: Date
  canPlay: boolean
  onPlay: () => void
  onOpen: () => void
}

const DAY_MS = 24 * 60 * 60 * 1000

/** "today", "yesterday", "3 days ago" — by local calendar day. */
export function daysAgo(iso: string, now: Date): string {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((start(now) - start(new Date(iso))) / DAY_MS)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** Distinct positions with a completed play. */
export const completedCount = (run: SequenceRun) =>
  new Set(run.nodes.filter(n => n.outcome === 'completed').map(n => n.position)).size

export function lastRunText(runs: SequenceRun[], now: Date): string {
  const last = runs[0]
  if (!last) return 'Not played yet'
  const when = daysAgo(last.startedAt, now)
  if (last.complete) return `Done ${when}`
  return `${completedCount(last)}/${last.nodeCount} ${when}`
}

export function SequenceTile({ widget, runs, now, canPlay, onPlay, onOpen }: SequenceTileProps) {
  const seq = widget.sequence
  const minutes = Math.max(1, Math.round((seq.timedSeconds + seq.nodeCount * 5) / 60))
  return (
    <article
      className="tracker-tile sequence-tile"
      data-testid="sequence-card"
      data-sequence={seq.name}
    >
      <button
        type="button"
        className="tracker-tile__open"
        aria-label={`Open ${seq.name}`}
        onClick={onOpen}
      />
      <div className="tracker-tile__body">
        <div className="tracker-tile__text">
          <h3 className="tracker-tile__name">{seq.name}</h3>
          <div className="tracker-tile__figure">
            <span className="tracker-tile__number">{seq.nodeCount}</span>
            <span className="tracker-tile__unit">
              {seq.nodeCount === 1 ? 'exercise' : 'exercises'} · ~{minutes} min
            </span>
          </div>
          <div className="tracker-tile__sub" data-testid="sequence-last-run">
            {lastRunText(runs, now)}
            {seq.version < seq.latestVersion && ' · update'}
          </div>
        </div>
        {canPlay && <span className="tracker-tile__action-slot" />}
      </div>
      {canPlay && (
        <button
          type="button"
          className="tracker-tile__action"
          aria-label={`Play ${seq.name}`}
          onClick={onPlay}
        >
          <Icon name="play" />
        </button>
      )}
    </article>
  )
}
