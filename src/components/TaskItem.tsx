/**
 * TaskItem component - renders a single task with actions
 */

import React, { useMemo, useRef, useState } from 'react'
import type { Task } from '../domain/types'
import { formatAge } from '../utils/formatters'
import { formatTagsForDisplay } from '../domain/utils/tags'
import { openQuestionCount, parsePlanNotes } from '../domain/planNotes'
import { NotesPopout } from './NotesPopout'
import { TagIcon } from '@wolffm/task-ui-components'

interface TaskItemProps {
  task: Task
  isDraggable?: boolean
  pendingOperations: Set<string>
  onComplete: (taskId: string) => void
  onDelete: (taskId: string) => void
  onEditTag: (taskId: string) => void
  onSetNotes?: (taskId: string, notes: string) => Promise<void>
  /** Rename the task. Absent ⇒ the title is plain text, not click-to-edit. */
  onRenameTask?: (taskId: string, title: string) => Promise<void>
  onDragStart?: (e: React.DragEvent, taskId: string) => void
  onDragEnd?: (e: React.DragEvent) => void
  selected?: boolean
  showCompleteButton?: boolean
  showDeleteButton?: boolean
  showTagButton?: boolean
}

export function TaskItem({
  task,
  isDraggable = true,
  pendingOperations,
  onComplete,
  onDelete,
  onEditTag,
  onSetNotes,
  onRenameTask,
  onDragStart,
  onDragEnd,
  selected = false,
  showCompleteButton = true,
  showDeleteButton = true,
  showTagButton = false
}: TaskItemProps) {
  const isCompleting = pendingOperations.has(`complete-${task.id}`)
  const isDeleting = pendingOperations.has(`delete-${task.id}`)
  // Completed tasks stay on the board, faded and struck through, until their 24h
  // window elapses. The ✓ is a toggle from here — clicking it reopens the task —
  // and the × still dismisses it immediately.
  const isCompleted = task.state === 'Completed'

  const hasNotes = !!(task.notes && task.notes.trim())
  // Notes open in a popout rather than inside the card: a plan is a 40–60 line
  // document, and the card can only ever give it a column's worth of width.
  const [notesOpen, setNotesOpen] = useState(false)

  // How many things this task is waiting on a human for. Surfaced on the card so
  // a reviewer can see which of a lane's tasks need them without opening each
  // one — Questions is the only section that asks anything, so it's the only
  // thing worth counting here.
  const openQuestions = useMemo(() => openQuestionCount(parsePlanNotes(task.notes)), [task.notes])

  // The popout portals to the app root: out of this card (which clips and
  // drags), but not out of `.task-app-container`, which is where every theme
  // token is scoped. Read at click time, so the ref is always populated.
  const itemRef = useRef<HTMLLIElement>(null)

  // A draggable element swallows mousedown-drag to start an HTML5 drag, so text
  // inside it can't be selected. Pressing inside a text region turns the row's
  // draggable OFF for that gesture, which hands the drag back to the browser as a
  // normal text selection; it flips back on mouseup so dragging the card
  // elsewhere is unaffected.
  const [textDragSuppressed, setTextDragSuppressed] = useState(false)
  const suppressDragForText = () => setTextDragSuppressed(true)
  const restoreDrag = () => setTextDragSuppressed(false)

  // Inline title editing: click the title to edit it in place.
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)

  const startEditTitle = () => {
    if (!onRenameTask || isCompleting || isDeleting) return
    setDraftTitle(task.title)
    setEditingTitle(true)
  }
  const saveTitle = async () => {
    if (!onRenameTask || savingTitle) return
    const next = draftTitle.trim()
    // Nothing to do for an unchanged or emptied title — just close the editor,
    // so a stray click-and-blur can never blank a task's name.
    if (!next || next === task.title) {
      setEditingTitle(false)
      return
    }
    setSavingTitle(true)
    try {
      await onRenameTask(task.id, next)
      setEditingTitle(false)
    } finally {
      setSavingTitle(false)
    }
  }

  return (
    <li
      ref={itemRef}
      className={`task-app__item hdk-advanced-surface hdk-advanced-surface--shift ${selected ? 'selected' : ''} ${isCompleted ? 'is-completed' : ''}`}
      data-task-id={task.id}
      data-task-state={task.state}
      draggable={isDraggable && !editingTitle && !textDragSuppressed}
      onMouseUp={restoreDrag}
      onMouseLeave={restoreDrag}
      onDragStart={
        onDragStart
          ? e => {
              // Never start a drag out from under an active text selection inside
              // this card — the user is selecting, not moving.
              const sel = window.getSelection()
              if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) {
                e.preventDefault()
                return
              }
              onDragStart(e, task.id)
            }
          : undefined
      }
      onDragEnd={e => {
        // Remove dragging class if present
        const el = e.currentTarget as HTMLElement
        el.classList.remove('dragging')
        // Call external onDragEnd if provided
        if (onDragEnd) {
          try {
            onDragEnd(e)
          } catch {
            // Ignore drag end errors
          }
        }
      }}
    >
      <div className="task-app__item-content">
        {editingTitle ? (
          <input
            className="task-app__title-input"
            value={draftTitle}
            autoFocus
            disabled={savingTitle}
            onChange={e => setDraftTitle(e.target.value)}
            // Committing on blur means clicking away saves, which is what a
            // click-to-edit field is expected to do.
            onBlur={() => void saveTitle()}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void saveTitle()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setEditingTitle(false)
              }
            }}
            // The row is draggable; without this a text selection inside the
            // input starts a drag instead of selecting.
            onDragStart={e => e.preventDefault()}
            aria-label="Task title"
          />
        ) : (
          <div
            className={`task-app__item-title ${onRenameTask ? 'is-editable' : ''}`}
            title={onRenameTask ? 'Click to rename' : task.title}
            role={onRenameTask ? 'button' : undefined}
            tabIndex={onRenameTask ? 0 : undefined}
            onClick={startEditTitle}
            onKeyDown={
              onRenameTask
                ? e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      startEditTitle()
                    }
                  }
                : undefined
            }
          >
            {task.title}
          </div>
        )}

        <div className="task-app__item-meta-row" onMouseDown={suppressDragForText}>
          {task.tag ? (
            <div className="task-app__item-tag">{formatTagsForDisplay(task.tag)}</div>
          ) : (
            <div />
          )}
          <div className="task-app__item-age">{formatAge(task.createdAt)}</div>
        </div>

        {openQuestions > 0 && (
          <div className="task-app__item-questions" onMouseDown={suppressDragForText}>
            {openQuestions} open {openQuestions === 1 ? 'question' : 'questions'}
          </div>
        )}
      </div>
      <div className="task-app__item-actions">
        {onSetNotes && (
          <button
            className={`task-app__action-btn task-app__notes-toggle ${hasNotes ? 'has-notes' : ''} ${openQuestions > 0 ? 'has-questions' : ''}`}
            onClick={() => setNotesOpen(true)}
            title={hasNotes ? 'Open notes' : 'Add notes'}
            aria-label={hasNotes ? 'Open notes' : 'Add notes'}
            aria-haspopup="dialog"
          >
            📝
          </button>
        )}
        {showTagButton && (
          <button
            className="task-app__action-btn task-app__edit-tag-btn"
            onClick={() => onEditTag(task.id)}
            title="Edit tags"
            disabled={isCompleting || isDeleting}
          >
            <TagIcon />
          </button>
        )}
        {showCompleteButton && (
          <button
            className={`task-app__action-btn task-app__complete-btn ${isCompleted ? 'is-completed' : ''}`}
            onClick={() => onComplete(task.id)}
            title={isCompleted ? 'Reopen task' : 'Complete task'}
            aria-label={isCompleted ? 'Reopen task' : 'Complete task'}
            aria-pressed={isCompleted}
            disabled={isCompleting || isDeleting}
          >
            {isCompleting ? '⏳' : isCompleted ? '↺' : '✓'}
          </button>
        )}
        {showDeleteButton && (
          <button
            className="task-app__action-btn task-app__delete-btn"
            onClick={() => onDelete(task.id)}
            title="Delete task"
            disabled={isCompleting || isDeleting}
          >
            {isDeleting ? '⏳' : '×'}
          </button>
        )}
      </div>

      {notesOpen && (
        <NotesPopout
          title={task.title}
          notes={task.notes}
          onSave={onSetNotes ? notes => onSetNotes(task.id, notes) : undefined}
          onClose={() => setNotesOpen(false)}
          startEditing={!hasNotes}
          host={itemRef.current?.closest('.task-app-container')}
        />
      )}
    </li>
  )
}
