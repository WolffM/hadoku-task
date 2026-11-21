/**
 * Make or edit a sequence: put exercises in a line and say how long each node
 * runs — a number of seconds (timed), or until "next" is pressed (manual).
 * Nodes move up and down and can repeat an exercise.
 *
 * A node pins the exercise version it was added at. When an exercise has been
 * edited since, the node says so and can be moved to the latest; nothing
 * changes until then. Saving an edit makes a new version of the sequence.
 */
import React from 'react'
import { Icon } from '@wolffm/themes'
import { Modal } from '@wolffm/task-ui-components'
import type { SequenceApi } from '../../api/sequences'
import type { Exercise, NodeMode, Sequence } from '../../domain/sequences'
import { COUNTDOWN_MS, formatDuration } from '../../domain/sequencePlayer'
import { ExerciseBuilder } from './ExerciseBuilder'

const DEFAULT_SECONDS = 30
const MAX_SECONDS = 7200
const MAX_NODES = 100

interface DraftNode {
  /** Stable React key: nodes can repeat an exercise. */
  key: number
  exercise: Exercise
  mode: NodeMode
  seconds: string
}

export interface SequenceBuilderProps {
  api: SequenceApi
  /** Editing this one (at its latest version); absent to make a new sequence. */
  sequence?: Sequence
  onSaved: (sequence: Sequence) => void
  onClose: () => void
}

let nextKey = 1

export function SequenceBuilder({ api, sequence, onSaved, onClose }: SequenceBuilderProps) {
  const [name, setName] = React.useState(sequence?.name ?? '')
  const [description, setDescription] = React.useState(sequence?.description ?? '')
  const [nodes, setNodes] = React.useState<DraftNode[]>(
    () =>
      sequence?.nodes.map(n => ({
        key: nextKey++,
        exercise: n.exercise,
        mode: n.mode,
        seconds: String(n.seconds ?? DEFAULT_SECONDS)
      })) ?? []
  )
  const [picking, setPicking] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const secondsOf = (n: DraftNode) => {
    const v = Number(n.seconds)
    return Number.isInteger(v) && v >= 1 && v <= MAX_SECONDS ? v : null
  }
  const invalid = nodes.some(n => n.mode === 'timed' && secondsOf(n) === null)
  const totalSeconds = nodes.reduce(
    (t, n) => t + COUNTDOWN_MS / 1000 + (n.mode === 'timed' ? (secondsOf(n) ?? 0) : 0),
    0
  )
  const manual = nodes.filter(n => n.mode === 'manual').length

  const update = (key: number, patch: Partial<DraftNode>) =>
    setNodes(ns => ns.map(n => (n.key === key ? { ...n, ...patch } : n)))
  const move = (i: number, by: -1 | 1) =>
    setNodes(ns => {
      const j = i + by
      if (j < 0 || j >= ns.length) return ns
      const copy = [...ns]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })
  const add = (exercise: Exercise) => {
    setNodes(ns => [
      ...ns,
      { key: nextKey++, exercise, mode: 'timed', seconds: String(DEFAULT_SECONDS) }
    ])
    setPicking(false)
  }
  const toLatest = async (n: DraftNode) => {
    try {
      const latest = await api.getExercise(n.exercise.id)
      if (latest.deleted) throw new Error(`${latest.name} was deleted from the library`)
      update(n.key, { exercise: latest })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const save = async () => {
    if (!name.trim() || nodes.length === 0 || invalid || saving) return
    setSaving(true)
    setError(null)
    const input = {
      name: name.trim(),
      description: description.trim() || null,
      nodes: nodes.map(n => ({
        exerciseId: n.exercise.id,
        exerciseVersion: n.exercise.version,
        mode: n.mode,
        seconds: n.mode === 'timed' ? secondsOf(n) : null
      }))
    }
    try {
      const saved = sequence
        ? await api.updateSequence(sequence.id, input)
        : await api.createSequence(input)
      onSaved(saved)
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen
      title={sequence ? 'Edit sequence' : 'New sequence'}
      onClose={onClose}
      onConfirm={save}
      confirmLabel={saving ? 'Saving…' : 'Save sequence'}
      confirmDisabled={!name.trim() || nodes.length === 0 || invalid || saving}
      className="sequence-dialog sequence-dialog--wide"
    >
      <form
        className="sequence-form"
        aria-label="Sequence"
        onSubmit={e => {
          e.preventDefault()
          void save()
        }}
      >
        <label className="sequence-field">
          <span>Name</span>
          <input
            className="sequence-input"
            aria-label="Sequence name"
            placeholder="Morning mobility, leg day…"
            value={name}
            maxLength={100}
            onChange={e => setName(e.target.value)}
          />
        </label>
        <label className="sequence-field">
          <span>Description</span>
          <input
            className="sequence-input"
            aria-label="Sequence description"
            placeholder="Optional"
            value={description}
            maxLength={2000}
            onChange={e => setDescription(e.target.value)}
          />
        </label>

        <div className="sequence-builder__head">
          <span>
            {nodes.length} {nodes.length === 1 ? 'exercise' : 'exercises'} · about{' '}
            {formatDuration(totalSeconds)}
            {manual > 0 && ` + ${manual} untimed`}
          </span>
          <span className="sequence-form__hint">Each starts with a 5 s countdown.</span>
        </div>

        <ol className="sequence-builder__nodes" aria-label="Exercises in order">
          {nodes.map((n, i) => (
            <li key={n.key} className="sequence-node" data-testid="builder-node">
              <span className="sequence-node__index">{i + 1}</span>
              <span className="sequence-node__thumb">
                {n.exercise.imageUrl ? (
                  <img src={n.exercise.imageUrl} alt="" />
                ) : (
                  <Icon name="image" />
                )}
              </span>
              <span className="sequence-node__name">
                {n.exercise.name}
                {n.exercise.version < n.exercise.latestVersion && (
                  <button
                    type="button"
                    className="sequence-badge"
                    title="This exercise was edited since it was added"
                    onClick={() => void toLatest(n)}
                  >
                    Update to v{n.exercise.latestVersion}
                  </button>
                )}
                {n.exercise.deleted && (
                  <span className="sequence-badge sequence-badge--muted">deleted</span>
                )}
              </span>
              <span
                className="sequence-node__mode"
                role="radiogroup"
                aria-label={`How ${n.exercise.name} ends`}
              >
                {(['timed', 'manual'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={n.mode === m}
                    className={`sequence-toggle${n.mode === m ? ' sequence-toggle--on' : ''}`}
                    title={
                      m === 'timed' ? 'Moves on when the timer ends' : 'Waits for you to press next'
                    }
                    onClick={() => update(n.key, { mode: m })}
                  >
                    {m === 'timed' ? 'Timed' : 'Manual'}
                  </button>
                ))}
              </span>
              {n.mode === 'timed' ? (
                <label className="sequence-node__seconds">
                  <input
                    className={`sequence-input sequence-input--seconds${secondsOf(n) === null ? ' sequence-input--bad' : ''}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_SECONDS}
                    aria-label={`Seconds for ${n.exercise.name}`}
                    value={n.seconds}
                    onChange={e => update(n.key, { seconds: e.target.value })}
                  />
                  <span>s</span>
                </label>
              ) : (
                <span className="sequence-node__seconds sequence-form__hint">until next</span>
              )}
              <span className="sequence-node__actions">
                <button
                  type="button"
                  className="sequence-icon-btn"
                  aria-label={`Move ${n.exercise.name} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <Icon name="chevron-up" />
                </button>
                <button
                  type="button"
                  className="sequence-icon-btn"
                  aria-label={`Move ${n.exercise.name} down`}
                  disabled={i === nodes.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <Icon name="chevron-down" />
                </button>
                <button
                  type="button"
                  className="sequence-icon-btn"
                  aria-label={`Remove ${n.exercise.name}`}
                  onClick={() => setNodes(ns => ns.filter(x => x.key !== n.key))}
                >
                  <Icon name="trash" />
                </button>
              </span>
            </li>
          ))}
        </ol>

        <button
          type="button"
          className="sequence-btn"
          disabled={nodes.length >= MAX_NODES}
          onClick={() => setPicking(true)}
        >
          <Icon name="plus" /> Add exercise
        </button>

        {error && (
          <p className="sequence-form__error" role="alert">
            {error}
          </p>
        )}
      </form>

      {picking && <ExercisePicker api={api} onPick={add} onClose={() => setPicking(false)} />}
    </Modal>
  )
}

/** Choose an exercise from the library, or make a new one and use it. */
export function ExercisePicker({
  api,
  onPick,
  onClose
}: {
  api: SequenceApi
  onPick: (exercise: Exercise) => void
  onClose: () => void
}) {
  const [q, setQ] = React.useState('')
  const [list, setList] = React.useState<Exercise[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)

  React.useEffect(() => {
    let live = true
    const id = window.setTimeout(() => {
      api.listExercises({ q: q.trim() || undefined }).then(
        ex => live && (setList(ex), setError(null)),
        err => live && setError((err as Error).message)
      )
    }, 200)
    return () => {
      live = false
      window.clearTimeout(id)
    }
  }, [api, q])

  return (
    <Modal
      isOpen
      title="Add an exercise"
      onClose={onClose}
      actions={
        <div className="modal-actions">
          <button type="button" className="sequence-btn" onClick={onClose}>
            Close
          </button>
        </div>
      }
      className="sequence-dialog"
    >
      <div className="sequence-picker">
        <div className="sequence-picker__bar">
          <input
            className="sequence-input"
            aria-label="Search exercises"
            placeholder="Search the library"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <button
            type="button"
            className="sequence-btn sequence-btn--primary"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" /> New
          </button>
        </div>
        {error && (
          <p className="sequence-form__error" role="alert">
            {error}
          </p>
        )}
        {list && list.length === 0 && (
          <p className="sequence-form__hint">
            No exercises{q ? ` match “${q}”` : ' yet'} — make one.
          </p>
        )}
        <ul className="exercise-grid" aria-label="Exercises">
          {list?.map(ex => (
            <li key={ex.id}>
              <button type="button" className="exercise-card" onClick={() => onPick(ex)}>
                <span className="exercise-card__thumb">
                  {ex.imageUrl ? <img src={ex.imageUrl} alt="" /> : <Icon name="image" size={28} />}
                </span>
                <span className="exercise-card__name">{ex.name}</span>
                {!ex.mine && <span className="exercise-card__by">shared</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {creating && (
        <ExerciseBuilder
          api={api}
          onSaved={ex => {
            setCreating(false)
            onPick(ex)
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </Modal>
  )
}
