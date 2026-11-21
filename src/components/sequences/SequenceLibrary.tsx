/**
 * The exercise library: everyone's sequences and exercises, guest tier and up.
 *
 * Two tabs. Sequences: play one, make one, edit or delete your own (an admin
 * can do it to anyone's), and — when opened from a board's "Add a widget" —
 * put one on the board. Exercises: the same for exercises.
 *
 * Edits make new versions and deletes are soft (worker/src/routes/library.ts),
 * so changing your sequence never changes it on someone else's board; this UI
 * says so where it matters.
 */
import React from 'react'
import { Icon } from '@wolffm/themes'
import { Modal } from '@wolffm/task-ui-components'
import { ConfirmModal } from '../modals/ConfirmModal'
import type { SequenceApi } from '../../api/sequences'
import type { Exercise, Sequence, SequenceSummary } from '../../domain/sequences'
import { COUNTDOWN_MS, formatDuration } from '../../domain/sequencePlayer'
import { ExerciseBuilder } from './ExerciseBuilder'
import { SequenceBuilder } from './SequenceBuilder'
import { SequencePlayer } from './SequencePlayer'

export interface SequenceLibraryProps {
  api: SequenceApi
  onError: (message: string) => void
  /** Opened from "Add a widget": each sequence offers "Add to board". */
  onPick?: (sequence: SequenceSummary) => Promise<boolean>
  onClose: () => void
}

type Tab = 'sequences' | 'exercises'

export function sequenceLength(
  s: Pick<SequenceSummary, 'nodeCount' | 'timedSeconds' | 'manualCount'>
) {
  const secs = s.timedSeconds + (s.nodeCount * COUNTDOWN_MS) / 1000
  return `${s.nodeCount} ${s.nodeCount === 1 ? 'exercise' : 'exercises'} · ${formatDuration(secs)}${
    s.manualCount > 0 ? ` + ${s.manualCount} untimed` : ''
  }`
}

export function SequenceLibrary({ api, onError, onPick, onClose }: SequenceLibraryProps) {
  const [tab, setTab] = React.useState<Tab>('sequences')
  const [q, setQ] = React.useState('')
  const [mineOnly, setMineOnly] = React.useState(false)
  const [sequences, setSequences] = React.useState<SequenceSummary[] | null>(null)
  const [exercises, setExercises] = React.useState<Exercise[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reload, setReload] = React.useState(0)

  const [editingSeq, setEditingSeq] = React.useState<Sequence | 'new' | null>(null)
  const [editingEx, setEditingEx] = React.useState<Exercise | 'new' | null>(null)
  const [playing, setPlaying] = React.useState<Sequence | null>(null)
  const [deleting, setDeleting] = React.useState<
    { kind: 'sequence'; item: SequenceSummary } | { kind: 'exercise'; item: Exercise } | null
  >(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  React.useEffect(() => {
    let live = true
    const query = { q: q.trim() || undefined, mine: mineOnly }
    const id = window.setTimeout(() => {
      const load =
        tab === 'sequences'
          ? api.listSequences(query).then(r => live && setSequences(r))
          : api.listExercises(query).then(r => live && setExercises(r))
      load.then(
        () => live && setLoadError(null),
        err => live && setLoadError((err as Error).message)
      )
    }, 200)
    return () => {
      live = false
      window.clearTimeout(id)
    }
  }, [api, tab, q, mineOnly, reload])

  const refresh = () => setReload(n => n + 1)

  const withFull = async (s: SequenceSummary, then: (full: Sequence) => void) => {
    setBusy(s.id)
    try {
      then(await api.getSequence(s.id))
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const pick = async (s: SequenceSummary) => {
    if (!onPick) return
    setBusy(s.id)
    const ok = await onPick(s)
    setBusy(null)
    if (ok) onClose()
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      if (deleting.kind === 'sequence') await api.deleteSequence(deleting.item.id)
      else await api.deleteExercise(deleting.item.id)
      setDeleting(null)
      setDeleteError(null)
      refresh()
    } catch (err) {
      setDeleteError((err as Error).message)
    }
  }

  const list = tab === 'sequences' ? sequences : exercises

  return (
    <Modal
      isOpen
      title={onPick ? 'Add a sequence' : 'Exercise library'}
      onClose={onClose}
      actions={
        <div className="modal-actions">
          <button type="button" className="sequence-btn" onClick={onClose}>
            Close
          </button>
        </div>
      }
      className="sequence-dialog sequence-dialog--wide sequence-library"
    >
      <div className="sequence-library__tabs" role="tablist" aria-label="Library">
        {(['sequences', 'exercises'] as const).map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`sequence-tab${tab === t ? ' sequence-tab--on' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'sequences' ? 'Sequences' : 'Exercises'}
          </button>
        ))}
      </div>

      <div className="sequence-picker__bar">
        <input
          className="sequence-input"
          aria-label={`Search ${tab}`}
          placeholder={`Search ${tab}`}
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <label className="sequence-check">
          <input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} />
          Mine
        </label>
        <button
          type="button"
          className="sequence-btn sequence-btn--primary"
          onClick={() => (tab === 'sequences' ? setEditingSeq('new') : setEditingEx('new'))}
        >
          <Icon name="plus" /> New {tab === 'sequences' ? 'sequence' : 'exercise'}
        </button>
      </div>

      {loadError && (
        <div className="sequence-form__error" role="alert">
          Couldn't load the library: {loadError}
          <button type="button" className="sequence-btn" onClick={refresh}>
            <Icon name="refresh" /> Retry
          </button>
        </div>
      )}
      {list && list.length === 0 && (
        <p className="sequence-form__hint sequence-library__empty">
          {q || mineOnly ? 'Nothing matches.' : `No ${tab} yet — make the first one.`}
        </p>
      )}

      {tab === 'sequences' ? (
        <ul className="sequence-list" aria-label="Sequences">
          {sequences?.map(s => (
            <li
              key={s.id}
              className="sequence-row"
              data-testid="library-sequence"
              data-sequence={s.name}
            >
              <div className="sequence-row__text">
                <span className="sequence-row__name">{s.name}</span>
                <span className="sequence-row__meta">
                  {sequenceLength(s)} · {s.mine ? 'yours' : 'shared'}
                </span>
                {s.description && <span className="sequence-row__desc">{s.description}</span>}
              </div>
              <div className="sequence-row__actions">
                <button
                  type="button"
                  className="sequence-icon-btn"
                  aria-label={`Play ${s.name}`}
                  disabled={busy === s.id}
                  onClick={() => void withFull(s, setPlaying)}
                >
                  <Icon name="play" />
                </button>
                {s.canEdit && (
                  <>
                    <button
                      type="button"
                      className="sequence-icon-btn"
                      aria-label={`Edit ${s.name}`}
                      disabled={busy === s.id}
                      onClick={() => void withFull(s, setEditingSeq)}
                    >
                      <Icon name="edit" />
                    </button>
                    <button
                      type="button"
                      className="sequence-icon-btn"
                      aria-label={`Delete ${s.name}`}
                      onClick={() => {
                        setDeleteError(null)
                        setDeleting({ kind: 'sequence', item: s })
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                  </>
                )}
                {onPick && (
                  <button
                    type="button"
                    className="sequence-btn sequence-btn--primary"
                    disabled={busy === s.id}
                    onClick={() => void pick(s)}
                  >
                    <Icon name="plus" /> Add to board
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="exercise-grid" aria-label="Exercises">
          {exercises?.map(ex => (
            <li
              key={ex.id}
              className="exercise-card exercise-card--static"
              data-testid="library-exercise"
            >
              <span className="exercise-card__thumb">
                {ex.imageUrl ? <img src={ex.imageUrl} alt="" /> : <Icon name="image" size={28} />}
              </span>
              <span className="exercise-card__name">{ex.name}</span>
              <span className="exercise-card__by">{ex.mine ? 'yours' : 'shared'}</span>
              {ex.canEdit && (
                <span className="exercise-card__actions">
                  <button
                    type="button"
                    className="sequence-icon-btn"
                    aria-label={`Edit ${ex.name}`}
                    onClick={() => setEditingEx(ex)}
                  >
                    <Icon name="edit" />
                  </button>
                  <button
                    type="button"
                    className="sequence-icon-btn"
                    aria-label={`Delete ${ex.name}`}
                    onClick={() => {
                      setDeleteError(null)
                      setDeleting({ kind: 'exercise', item: ex })
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {editingSeq && (
        <SequenceBuilder
          api={api}
          sequence={editingSeq === 'new' ? undefined : editingSeq}
          onSaved={() => {
            setEditingSeq(null)
            setTab('sequences')
            refresh()
          }}
          onClose={() => setEditingSeq(null)}
        />
      )}
      {editingEx && (
        <ExerciseBuilder
          api={api}
          exercise={editingEx === 'new' ? undefined : editingEx}
          onSaved={() => {
            setEditingEx(null)
            refresh()
          }}
          onClose={() => setEditingEx(null)}
        />
      )}
      {playing && (
        <SequencePlayer
          sequence={playing}
          api={api}
          onError={onError}
          onClose={() => setPlaying(null)}
        />
      )}

      <ConfirmModal
        isOpen={deleting !== null}
        title={deleting?.kind === 'exercise' ? 'Delete exercise?' : 'Delete sequence?'}
        message={
          <>
            <strong>{deleting?.item.name}</strong> leaves the library.{' '}
            {deleting?.kind === 'exercise'
              ? 'Sequences that already use it keep it.'
              : 'Boards that already have it keep playing it.'}
          </>
        }
        confirmLabel="Delete"
        error={deleteError}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </Modal>
  )
}
