/**
 * EditBoardsModal
 *
 * Manage all boards from one place: create, rename, pin/unpin, reorder the
 * pinned set, and delete. The top bar shows the pinned boards (up to
 * TOPBAR_BOARD_SLOTS); everything else is reached from here via search.
 *
 * Pin/reorder are expressed as a single "pinned order" (the exact top-bar order)
 * and sent through onSetPinned — matching the server's setPinnedBoards write.
 * Each action calls the api and the parent reloads, so this component renders
 * directly off the `boards` prop rather than holding a divergent local copy.
 */
import React, { useMemo, useState } from 'react'
import { Modal } from '@wolffm/task-ui-components'
import type { Board } from '../../domain/types'

export interface EditBoardsModalProps {
  isOpen: boolean
  boards: Board[]
  currentBoardId: string
  slots: number
  onClose: () => void
  onCreate: (name: string) => Promise<void>
  onRename: (boardId: string, name: string) => Promise<void>
  onDelete: (boardId: string) => Promise<void>
  onSetPinned: (order: string[]) => Promise<void>
  validateBoardName: (name: string) => string | null
}

export function EditBoardsModal({
  isOpen,
  boards,
  currentBoardId,
  slots,
  onClose,
  onCreate,
  onRename,
  onDelete,
  onSetPinned,
  validateBoardName
}: EditBoardsModalProps) {
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [busy, setBusy] = useState(false)

  // Pinned order = the pinned boards in their stored position order. boards
  // arrives server-ordered (pinned first, by position), so filtering keeps it.
  const pinnedOrder = useMemo(() => boards.filter(b => b.pinned).map(b => b.id), [boards])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return boards
    return boards.filter(b => b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q))
  }, [boards, search])

  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const togglePin = (id: string) =>
    run(() =>
      onSetPinned(
        pinnedOrder.includes(id) ? pinnedOrder.filter(x => x !== id) : [...pinnedOrder, id]
      )
    )

  const move = (id: string, dir: -1 | 1) => {
    const i = pinnedOrder.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= pinnedOrder.length) return
    const next = [...pinnedOrder]
    ;[next[i], next[j]] = [next[j], next[i]]
    return run(() => onSetPinned(next))
  }

  const startEdit = (b: Board) => {
    setEditingId(b.id)
    setEditValue(b.name)
  }
  const commitEdit = (id: string) => {
    const name = editValue.trim()
    setEditingId(null)
    if (!name || validateBoardName(name)) return
    const current = boards.find(b => b.id === id)
    if (!current || current.name === name) return
    void run(() => onRename(id, name))
  }

  const create = () => {
    const name = newName.trim()
    if (!name || validateBoardName(name)) return
    void run(async () => {
      await onCreate(name)
      setNewName('')
    })
  }

  const createInvalid = !newName.trim() || validateBoardName(newName) !== null

  return (
    <Modal
      isOpen={isOpen}
      title="Edit Boards"
      onClose={onClose}
      showConfirm={false}
      cancelLabel="Done"
      className="edit-boards-modal"
    >
      <p className="modal-hint">
        Pinned boards appear in the top bar (up to {slots}) and load first. Everything else is
        reached here.
      </p>

      <div className="edit-boards__create">
        <input
          className="edit-boards__new-input"
          type="text"
          placeholder="New board name"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') create()
          }}
          aria-label="New board name"
        />
        <button className="edit-boards__create-btn" onClick={create} disabled={createInvalid || busy}>
          Add board
        </button>
      </div>

      {boards.length > 6 && (
        <input
          className="edit-boards__search"
          type="search"
          placeholder="Search boards…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search boards"
        />
      )}

      <ul className="edit-boards__list">
        {filtered.map(b => {
          const isPinned = !!b.pinned
          const pinIdx = pinnedOrder.indexOf(b.id)
          const isMain = b.id === 'main'
          return (
            <li
              key={b.id}
              className={`edit-boards__row ${b.id === currentBoardId ? 'is-current' : ''}`}
            >
              <button
                className={`edit-boards__pin ${isPinned ? 'is-pinned' : ''}`}
                onClick={() => togglePin(b.id)}
                disabled={busy}
                title={isPinned ? 'Unpin from top bar' : 'Pin to top bar'}
                aria-label={isPinned ? `Unpin ${b.name}` : `Pin ${b.name}`}
                aria-pressed={isPinned}
              >
                {isPinned ? '★' : '☆'}
              </button>

              {editingId === b.id ? (
                <input
                  className="edit-boards__name-input"
                  type="text"
                  value={editValue}
                  autoFocus
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={() => commitEdit(b.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitEdit(b.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  aria-label={`Rename ${b.name}`}
                />
              ) : (
                <button
                  className="edit-boards__name"
                  onClick={() => startEdit(b)}
                  title="Rename"
                >
                  {b.name}
                </button>
              )}

              <div className="edit-boards__actions">
                {isPinned && (
                  <>
                    <button
                      className="edit-boards__move"
                      onClick={() => move(b.id, -1)}
                      disabled={pinIdx <= 0 || busy}
                      title="Move up"
                      aria-label={`Move ${b.name} up`}
                    >
                      ↑
                    </button>
                    <button
                      className="edit-boards__move"
                      onClick={() => move(b.id, 1)}
                      disabled={pinIdx < 0 || pinIdx >= pinnedOrder.length - 1 || busy}
                      title="Move down"
                      aria-label={`Move ${b.name} down`}
                    >
                      ↓
                    </button>
                  </>
                )}
                {!isMain && (
                  <button
                    className="edit-boards__delete"
                    onClick={() => {
                      if (window.confirm(`Delete board "${b.name}" and all its tasks?`)) {
                        void run(() => onDelete(b.id))
                      }
                    }}
                    disabled={busy}
                    title="Delete board"
                    aria-label={`Delete ${b.name}`}
                  >
                    🗑
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
