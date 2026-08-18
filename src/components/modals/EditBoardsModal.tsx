/**
 * EditBoardsModal
 *
 * Manage all boards from one place: create, rename, pin/unpin, DRAG to reorder
 * the pinned set, delete, and SHARE (§7). The top bar shows the pinned boards
 * (up to TOPBAR_BOARD_SLOTS); everything else is reached here via search.
 *
 * Pin/reorder are a single "pinned order" (the exact top-bar order) sent through
 * onSetPinned. Sharing is a set of direct server calls injected as `shareApi`:
 * grantee identity is a DISPLAY NAME (autocompleted against live registry names —
 * safe to expose, no auth bearing), never a raw key. Boards shared WITH the user
 * group separately and offer Leave instead of Share/Delete.
 */
import React, { useMemo, useState } from 'react'
import { Modal } from '@wolffm/task-ui-components'
import type { Board } from '../../domain/types'
import { effectivePinnedIds } from '../../domain/utils/boardPins'
import { TOPBAR_BOARD_SLOTS } from '../../app/constants'
import { ShareIcon } from '../ShareIcon'
import { Icon } from '@wolffm/themes'
import { boardRef, type ShareApi } from './shareApi'
import { SharePanel } from './SharePanel'
import { AutomationPanel } from './AutomationPanel'

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
  shareApi: ShareApi
  /** Reload boards from the server (after activate/deactivate changes a board's mode). */
  onReloadBoards: () => Promise<void>
  validateBoardName: (name: string) => string | null
}

const isOwned = (b: Board): boolean => !b.access || b.access === 'owner'

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
  shareApi,
  onReloadBoards,
  validateBoardName
}: EditBoardsModalProps) {
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [sharingId, setSharingId] = useState<string | null>(null)
  const [automatingId, setAutomatingId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // The favorited set the toggle operates on. Defaults to the first N standard
  // boards when nothing is explicitly favorited yet (effectivePinnedIds), so the
  // first favorite is additive onto that baseline instead of collapsing the top
  // bar to a single board. Same set BoardsSection renders — they stay in sync.
  const pinnedOrder = useMemo(() => effectivePinnedIds(boards, TOPBAR_BOARD_SLOTS), [boards])
  const pinnedSet = useMemo(() => new Set(pinnedOrder), [pinnedOrder])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return boards
    return boards.filter(b => b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q))
  }, [boards, search])

  // Split owned vs shared-with-me so the picker groups them (§7.3).
  const owned = useMemo(() => filtered.filter(isOwned), [filtered])
  const shared = useMemo(() => filtered.filter(b => !isOwned(b)), [filtered])

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

  // Drag-to-reorder within the pinned set. Reorder is computed on drop only (no
  // flicker); the transient highlight comes from dragOverId.
  const commitDrop = (targetId: string) => {
    const from = dragId ? pinnedOrder.indexOf(dragId) : -1
    const to = pinnedOrder.indexOf(targetId)
    setDragId(null)
    setDragOverId(null)
    if (from < 0 || to < 0 || from === to) return
    const next = [...pinnedOrder]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    void run(() => onSetPinned(next))
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

  const renderRow = (b: Board) => {
    const isPinned = pinnedSet.has(b.id)
    const isMain = b.id === 'main'
    const owns = isOwned(b)
    const draggable = isPinned && !editingId
    return (
      <React.Fragment key={b.id}>
        <li
          className={[
            'edit-boards__row',
            'hdk-advanced-surface',
            'hdk-advanced-surface--shift',
            b.id === currentBoardId ? 'is-current' : '',
            draggable ? 'is-draggable' : '',
            dragId === b.id ? 'is-dragging' : '',
            dragOverId === b.id ? 'is-drag-over' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          draggable={draggable}
          onDragStart={
            draggable
              ? e => {
                  setDragId(b.id)
                  e.dataTransfer.effectAllowed = 'move'
                }
              : undefined
          }
          onDragOver={
            isPinned
              ? e => {
                  if (dragId && dragId !== b.id) {
                    e.preventDefault()
                    setDragOverId(b.id)
                  }
                }
              : undefined
          }
          onDrop={
            isPinned
              ? e => {
                  e.preventDefault()
                  commitDrop(b.id)
                }
              : undefined
          }
          onDragEnd={() => {
            setDragId(null)
            setDragOverId(null)
          }}
        >
          {isPinned ? (
            <span className="edit-boards__grip" title="Drag to reorder" aria-hidden="true">
              ⠿
            </span>
          ) : (
            <span className="edit-boards__grip edit-boards__grip--empty" aria-hidden="true" />
          )}

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
              onClick={() => (owns ? startEdit(b) : undefined)}
              title={owns ? 'Rename' : `Shared by someone else · ${b.access}`}
              disabled={!owns}
            >
              {b.name}
              {!owns && <span className="edit-boards__badge">{b.access}</span>}
            </button>
          )}

          <div className="edit-boards__actions">
            {owns ? (
              <>
                <button
                  className={`edit-boards__share ${sharingId === b.id ? 'is-open' : ''}`}
                  onClick={() => {
                    setSharingId(sharingId === b.id ? null : b.id)
                    setAutomatingId(null)
                  }}
                  disabled={busy}
                  title="Share this board"
                  aria-label={`Share ${b.name}`}
                  aria-expanded={sharingId === b.id}
                >
                  <ShareIcon />
                </button>
                <button
                  className={`edit-boards__automate ${automatingId === b.id ? 'is-open' : ''}`}
                  onClick={() => {
                    setAutomatingId(automatingId === b.id ? null : b.id)
                    setSharingId(null)
                  }}
                  disabled={busy}
                  title={
                    b.mode === 'automation'
                      ? 'Automation settings'
                      : 'Convert to an automation board'
                  }
                  aria-label={`Automation for ${b.name}`}
                  aria-expanded={automatingId === b.id}
                >
                  <Icon name="robot" />
                </button>
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
                    <Icon name="trash" />
                  </button>
                )}
              </>
            ) : (
              <button
                className="edit-boards__leave"
                onClick={() => {
                  if (window.confirm(`Leave shared board "${b.name}"?`)) {
                    void run(async () => {
                      await shareApi.revokeShare(boardRef(b), 'me')
                    })
                  }
                }}
                disabled={busy}
                title="Leave this shared board"
                aria-label={`Leave ${b.name}`}
              >
                Leave
              </button>
            )}
          </div>
        </li>

        {sharingId === b.id && owns && (
          <li className="edit-boards__share-row">
            <SharePanel board={b} shareApi={shareApi} />
          </li>
        )}

        {automatingId === b.id && owns && (
          <li className="edit-boards__share-row">
            <AutomationPanel
              board={b}
              shareApi={shareApi}
              onDone={async () => {
                setAutomatingId(null)
                await onReloadBoards()
              }}
            />
          </li>
        )}
      </React.Fragment>
    )
  }

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
        Pinned boards appear in the top bar (up to {slots}) and load first. Drag the ⠿ handle to
        reorder them. Everything else is reached here.
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
        <button
          className="edit-boards__create-btn"
          onClick={create}
          disabled={createInvalid || busy}
        >
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

      <ul className="edit-boards__list">{owned.map(renderRow)}</ul>

      {shared.length > 0 && (
        <>
          <p className="edit-boards__group-label">Shared with me</p>
          <ul className="edit-boards__list">{shared.map(renderRow)}</ul>
        </>
      )}
    </Modal>
  )
}
