/**
 * Make or edit an exercise: a name, an optional description, and a picture
 * showing the movement. The picture uploads as soon as it is chosen (to
 * cdn.hadoku.me, through the worker), so Save only sends its key.
 *
 * Saving an edit makes a new version; sequences that already use this
 * exercise keep the version they pinned.
 */
import React from 'react'
import { Icon } from '@wolffm/themes'
import { Modal } from '@wolffm/task-ui-components'
import type { SequenceApi } from '../../api/sequences'
import type { Exercise } from '../../domain/sequences'

/** The worker's cap (MAX_IMAGE_BYTES in worker/src/routes/library.ts). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export interface ExerciseBuilderProps {
  api: SequenceApi
  /** Editing this one; absent to make a new exercise. */
  exercise?: Exercise
  onSaved: (exercise: Exercise) => void
  onClose: () => void
}

export function ExerciseBuilder({ api, exercise, onSaved, onClose }: ExerciseBuilderProps) {
  const [name, setName] = React.useState(exercise?.name ?? '')
  const [description, setDescription] = React.useState(exercise?.description ?? '')
  const [image, setImage] = React.useState<{ key: string; url: string } | null>(
    exercise?.imageKey && exercise.imageUrl
      ? { key: exercise.imageKey, url: exercise.imageUrl }
      : null
  )
  const [uploading, setUploading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const choose = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Pictures can be up to 5 MB')
      return
    }
    setUploading(true)
    try {
      const up = await api.uploadImage(file)
      setImage({ key: up.imageKey, url: up.imageUrl })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const save = async () => {
    if (!name.trim() || saving || uploading) return
    setSaving(true)
    setError(null)
    const input = {
      name: name.trim(),
      description: description.trim() || null,
      imageKey: image?.key ?? null
    }
    try {
      const saved = exercise
        ? await api.updateExercise(exercise.id, input)
        : await api.createExercise(input)
      onSaved(saved)
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen
      title={exercise ? 'Edit exercise' : 'New exercise'}
      onClose={onClose}
      onConfirm={save}
      confirmLabel={saving ? 'Saving…' : 'Save exercise'}
      confirmDisabled={!name.trim() || saving || uploading}
      className="sequence-dialog"
    >
      <form
        className="sequence-form"
        aria-label="Exercise"
        onSubmit={e => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="exercise-picture">
          {image ? (
            <img
              src={image.url}
              alt=""
              className="exercise-picture__img"
              data-testid="exercise-picture"
            />
          ) : (
            <div className="exercise-picture__empty">
              <Icon name="image" size={36} />
              <span>No picture</span>
            </div>
          )}
          <div className="exercise-picture__actions">
            <button
              type="button"
              className="sequence-btn"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="upload" />{' '}
              {uploading ? 'Uploading…' : image ? 'Change picture' : 'Add picture'}
            </button>
            {image && !uploading && (
              <button type="button" className="sequence-btn" onClick={() => setImage(null)}>
                <Icon name="close" /> Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
              aria-label="Exercise picture"
              hidden
              onChange={e => void choose(e.target.files?.[0])}
            />
          </div>
          <p className="sequence-form__hint">
            PNG, JPEG, GIF, WebP or AVIF up to 5 MB. Pictures are public.
          </p>
        </div>
        <label className="sequence-field">
          <span>Name</span>
          <input
            className="sequence-input"
            aria-label="Exercise name"
            placeholder="Plank, squat, child's pose…"
            value={name}
            maxLength={100}
            onChange={e => setName(e.target.value)}
          />
        </label>
        <label className="sequence-field">
          <span>How to do it</span>
          <textarea
            className="sequence-input sequence-input--area"
            aria-label="Exercise description"
            placeholder="Optional"
            value={description}
            maxLength={2000}
            rows={3}
            onChange={e => setDescription(e.target.value)}
          />
        </label>
        {exercise && (
          <p className="sequence-form__hint">
            Saving makes version {exercise.latestVersion + 1}. Sequences already using this exercise
            keep the version they have.
          </p>
        )}
        {error && (
          <p className="sequence-form__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
