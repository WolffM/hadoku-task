/**
 * The plan-review surface.
 *
 * Notes stopped being a scratch field the moment TenHands' pipeline started
 * parking tasks in `plan-review` for a human to answer — every task on every
 * automation board is now read and replied to through this. A 40–60 line plan
 * inside a task card meant reading a ~1900px document through a 190×360 window,
 * so the viewer lives outside the card entirely.
 *
 * Three things it is built around:
 *
 *   - It portals OUT of the task card but INTO `.task-app-container`. The card
 *     is `overflow: hidden` (advanced surface) and draggable, so an overlay
 *     rendered inside it gets clipped and fights the drag handler. Escaping all
 *     the way to <body> is wrong too: every theme token is scoped to
 *     `.task-app-container[data-theme]`, so a panel outside it keeps the light
 *     defaults and burns a white rectangle into a dark board.
 *   - Edit is never smaller than read. Both modes fill the same flex body, and
 *     the panel grows when editing — writing the reply is the interaction the
 *     protocol depends on, so it gets the most room, not the least.
 *   - Questions is the only section that asks anything of the human, so it is
 *     the only one that looks different: accented, counted in the header, and
 *     followed immediately by the box you answer in.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  appendAnswerToNotes,
  openQuestionCount,
  parsePlanNotes,
  type PlanSection
} from '../domain/planNotes'
import { PlanMarkdown } from './PlanMarkdown'

interface NotesPopoutProps {
  title: string
  notes: string | null | undefined
  /** Absent ⇒ read-only (the caller couldn't save anyway). */
  onSave?: (notes: string) => Promise<void>
  onClose: () => void
  /** Open straight into the editor — used by "Add notes" on an empty task. */
  startEditing?: boolean
  /** Where to portal. Must be inside `.task-app-container` to inherit the theme. */
  host?: Element | null
}

export function NotesPopout({
  title,
  notes,
  onSave,
  onClose,
  startEditing = false,
  host
}: NotesPopoutProps) {
  const [editing, setEditing] = useState(startEditing)
  const [draft, setDraft] = useState(notes ?? '')
  const [reply, setReply] = useState('')
  const [saving, setSaving] = useState(false)

  const sections = useMemo(() => parsePlanNotes(notes), [notes])
  const questionCount = useMemo(() => openQuestionCount(sections), [sections])
  const panelRef = useRef<HTMLDivElement>(null)

  // Keep focus inside the dialog: on open, and again whenever the mode flips.
  // Leaving edit mode unmounts the textarea (and the Cancel button that was
  // clicked), which drops focus onto <body> — and since the Escape handler is
  // scoped to the panel, a key pressed there would reach nothing and the dialog
  // would look stuck. Guarded so it never steals from a field that already has
  // focus, such as the editor's own autoFocus or the reply box.
  useEffect(() => {
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) panel.focus()
  }, [editing])

  // The board behind the overlay must not scroll under it.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const commit = async (next: string) => {
    if (!onSave || saving) return false
    setSaving(true)
    try {
      await onSave(next)
      return true
    } finally {
      setSaving(false)
    }
  }

  const saveDraft = async () => {
    if (await commit(draft)) setEditing(false)
  }

  const sendReply = async () => {
    if (!reply.trim()) return
    if (await commit(appendAnswerToNotes(notes, reply))) setReply('')
  }

  const startEdit = () => {
    setDraft(notes ?? '')
    setEditing(true)
  }

  // Escape backs out one level at a time: editor first, then the dialog. Losing
  // a half-written reply to a stray Escape is exactly the failure this surface
  // can't afford.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      if (editing) setEditing(false)
      else onClose()
    }
  }

  const hasNotes = !!(notes && notes.trim())

  return createPortal(
    <div className="notes-popout__overlay" onClick={onClose} onMouseDown={e => e.stopPropagation()}>
      <div
        ref={panelRef}
        className={`notes-popout ${editing ? 'notes-popout--editing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Notes for ${title}`}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <header className="notes-popout__header">
          <div className="notes-popout__heading">
            <h2 className="notes-popout__title">{title}</h2>
            {questionCount > 0 && !editing && (
              <span className="notes-popout__question-count">
                {questionCount} open {questionCount === 1 ? 'question' : 'questions'}
              </span>
            )}
          </div>
          <button className="notes-popout__close" onClick={onClose} aria-label="Close notes">
            ×
          </button>
        </header>

        {editing ? (
          <>
            <textarea
              className="notes-popout__editor"
              value={draft}
              autoFocus
              placeholder="Write a plan or notes (markdown)…"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void saveDraft()
              }}
            />
            <footer className="notes-popout__footer">
              <span className="notes-popout__hint">⌘/Ctrl + Enter to save</span>
              <button
                className="notes-popout__btn"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="notes-popout__btn notes-popout__btn--primary"
                onClick={() => void saveDraft()}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </footer>
          </>
        ) : (
          <>
            <div className="notes-popout__body">
              {hasNotes ? (
                sections.map((section, i) => (
                  <PlanSectionView
                    key={i}
                    section={section}
                    reply={reply}
                    onReplyChange={setReply}
                    onReplySubmit={() => void sendReply()}
                    canReply={!!onSave}
                    saving={saving}
                  />
                ))
              ) : (
                <p className="notes-popout__empty">No notes yet.</p>
              )}
            </div>
            <footer className="notes-popout__footer">
              <button className="notes-popout__btn" onClick={onClose}>
                Close
              </button>
              {onSave && (
                <button
                  className="notes-popout__btn notes-popout__btn--primary"
                  onClick={startEdit}
                >
                  {hasNotes ? 'Edit' : 'Add notes'}
                </button>
              )}
            </footer>
          </>
        )}
      </div>
    </div>,
    host ?? document.body
  )
}

interface PlanSectionViewProps {
  section: PlanSection
  reply: string
  onReplyChange: (value: string) => void
  onReplySubmit: () => void
  canReply: boolean
  saving: boolean
}

function PlanSectionView({
  section,
  reply,
  onReplyChange,
  onReplySubmit,
  canReply,
  saving
}: PlanSectionViewProps) {
  return (
    <section
      className={`notes-popout__section ${section.isQuestions ? 'notes-popout__section--questions' : ''}`}
    >
      {section.title && <h3 className="notes-popout__section-title">{section.title}</h3>}
      {section.body && <PlanMarkdown body={section.body} />}

      {section.isQuestions && canReply && (
        <div className="notes-popout__reply">
          <label className="notes-popout__reply-label" htmlFor="notes-popout-reply">
            Answer here — anything you type is added to the notes. Free text; no format required.
          </label>
          <textarea
            id="notes-popout-reply"
            className="notes-popout__reply-input"
            value={reply}
            rows={3}
            placeholder="Type your answers…"
            onChange={e => onReplyChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onReplySubmit()
            }}
          />
          <div className="notes-popout__reply-actions">
            <button
              className="notes-popout__btn notes-popout__btn--primary"
              onClick={onReplySubmit}
              disabled={saving || !reply.trim()}
            >
              {saving ? 'Adding…' : 'Add answer'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
