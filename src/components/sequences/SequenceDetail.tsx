/**
 * One sequence widget, opened from its tile: what it plays, its recent runs
 * (each node play counted — completed, skipped, repeated), and the rarer
 * actions: move to the sequence's latest version when its author has edited
 * it, and take it off the board.
 */
import { Icon } from '@wolffm/themes'
import { Modal } from '@wolffm/task-ui-components'
import type { SequenceRun, SequenceWidget } from '../../domain/sequences'
import { completedCount, daysAgo } from './SequenceTile'

export interface SequenceDetailProps {
  widget: SequenceWidget
  runs: SequenceRun[]
  now: Date
  canWrite: boolean
  onPlay: () => void
  onUpdate: () => void
  onRemove: () => void
  onClose: () => void
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function runSummary(run: SequenceRun) {
  const done = completedCount(run)
  const skipped = run.nodes.filter(n => n.outcome === 'skipped').length
  const repeats = run.nodes.length - new Set(run.nodes.map(n => n.position)).size
  const parts = [run.complete ? 'Complete' : `${done}/${run.nodeCount} done`]
  if (skipped) parts.push(`${skipped} skipped`)
  if (repeats) parts.push(`${repeats} repeated`)
  if (run.status === 'stopped') parts.push('stopped early')
  if (run.status === 'active') parts.push('in progress')
  return parts.join(' · ')
}

export function SequenceDetail({
  widget,
  runs,
  now,
  canWrite,
  onPlay,
  onUpdate,
  onRemove,
  onClose
}: SequenceDetailProps) {
  const seq = widget.sequence
  return (
    <Modal
      isOpen
      title={seq.name}
      onClose={onClose}
      className="sequence-dialog sequence-detail"
      actions={
        <div className="modal-actions sequence-detail__actions">
          {canWrite && (
            <button type="button" className="sequence-btn" onClick={onRemove}>
              <Icon name="trash" /> Remove from board
            </button>
          )}
          <button type="button" className="sequence-btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="sequence-btn sequence-btn--primary" onClick={onPlay}>
            <Icon name="play" /> Play
          </button>
        </div>
      }
    >
      {seq.description && <p className="sequence-detail__desc">{seq.description}</p>}
      {seq.version < seq.latestVersion && (
        <div className="sequence-detail__update" role="status">
          <span>
            {seq.mine ? 'You' : 'Its author'} edited this sequence (v{seq.latestVersion}). This
            board plays v{seq.version} until you update.
          </span>
          {canWrite && (
            <button type="button" className="sequence-btn sequence-btn--primary" onClick={onUpdate}>
              Update to v{seq.latestVersion}
            </button>
          )}
        </div>
      )}
      {seq.deleted && (
        <p className="sequence-form__hint">Deleted from the library — it still plays here.</p>
      )}

      <ol className="sequence-detail__nodes" aria-label="Exercises">
        {seq.nodes.map(n => (
          <li key={n.position}>
            <span className="sequence-node__thumb">
              {n.exercise.imageUrl ? (
                <img src={n.exercise.imageUrl} alt="" />
              ) : (
                <Icon name="image" />
              )}
            </span>
            <span className="sequence-detail__node-name">{n.exercise.name}</span>
            <span className="sequence-detail__node-len">
              {n.mode === 'timed' ? `${n.seconds} s` : 'until next'}
            </span>
          </li>
        ))}
      </ol>

      <h4 className="sequence-detail__heading">Recent runs</h4>
      {runs.length === 0 ? (
        <p className="sequence-form__hint">Not played from this board yet.</p>
      ) : (
        <ul className="sequence-detail__runs" data-testid="sequence-runs">
          {runs.slice(0, 20).map(r => (
            <li key={r.id} className={r.complete ? 'sequence-run--complete' : undefined}>
              <span className="sequence-detail__run-when">
                {daysAgo(r.startedAt, now)} {clock(r.startedAt)}
              </span>
              <span className="sequence-detail__run-what">{runSummary(r)}</span>
              {!r.mine && <span className="exercise-card__by">someone else</span>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
