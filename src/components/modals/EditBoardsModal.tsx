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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@wolffm/task-ui-components'
import type { Board } from '../../domain/types'

export type ShareLevel = 'readonly' | 'contributor'

export interface ShareRow {
  granteeUserId: string
  name?: string | null
  tier?: string | null
  level: string
  createdAt: string
}

/** Server-only sharing calls, injected from the api client. */
export interface ShareApi {
  searchUsers: (q: string) => Promise<Array<{ name: string; tier?: string }>>
  listShares: (boardRef: string) => Promise<ShareRow[]>
  grantShare: (
    boardRef: string,
    input: { name?: string; userId?: string; level: ShareLevel }
  ) => Promise<{ ok: boolean; error?: string; granted?: { name: string | null; tier: string | null; level: string } }>
  revokeShare: (boardRef: string, granteeUserId: string) => Promise<boolean>
}

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
  validateBoardName: (name: string) => string | null
}

/** A board's stable API reference for sharing: its handle, else its slug. */
const boardRef = (b: Board): string => b.handle ?? b.id
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
  validateBoardName
}: EditBoardsModalProps) {
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [sharingId, setSharingId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const pinnedOrder = useMemo(() => boards.filter(b => b.pinned).map(b => b.id), [boards])

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
      onSetPinned(pinnedOrder.includes(id) ? pinnedOrder.filter(x => x !== id) : [...pinnedOrder, id])
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
    const isPinned = !!b.pinned
    const isMain = b.id === 'main'
    const owns = isOwned(b)
    const draggable = isPinned && !editingId
    return (
      <React.Fragment key={b.id}>
        <li
          className={[
            'edit-boards__row',
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
                  onClick={() => setSharingId(sharingId === b.id ? null : b.id)}
                  disabled={busy}
                  title="Share this board"
                  aria-label={`Share ${b.name}`}
                  aria-expanded={sharingId === b.id}
                >
                  👥
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
                    🗑
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

/**
 * The per-board share panel: autocomplete a display name, pick an access level,
 * grant, and manage existing grantees. Only real, active names can be granted.
 * Exported so the toolbar's share dialog can reuse it for the current board.
 */
export function SharePanel({ board, shareApi }: { board: Board; shareApi: ShareApi }) {
  const ref = boardRef(board)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ name: string; tier?: string }>>([])
  const [picked, setPicked] = useState<{ name: string; tier?: string } | null>(null)
  const [level, setLevel] = useState<ShareLevel>('contributor')
  const [grantees, setGrantees] = useState<ShareRow[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(() => {
    void shareApi.listShares(ref).then(setGrantees)
  }, [shareApi, ref])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Debounced autocomplete. A pick clears the query text; typing again re-opens.
  useEffect(() => {
    if (picked && picked.name === query) return
    if (debounce.current) clearTimeout(debounce.current)
    const q = query.trim()
    if (!q) {
      setResults([])
      return
    }
    debounce.current = setTimeout(() => {
      void shareApi.searchUsers(q).then(setResults)
    }, 180)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [query, picked, shareApi])

  const grant = () => {
    if (!picked || busy) return
    setBusy(true)
    setMsg(null)
    void shareApi
      .grantShare(ref, { name: picked.name, level })
      .then(res => {
        if (res.ok) {
          setMsg({ kind: 'ok', text: `Shared with ${res.granted?.name ?? picked.name} (${res.granted?.tier ?? '—'})` })
          setQuery('')
          setPicked(null)
          setResults([])
          refresh()
        } else {
          setMsg({ kind: 'err', text: res.error ?? 'Could not share' })
        }
      })
      .finally(() => setBusy(false))
  }

  const revoke = (g: ShareRow) => {
    if (busy) return
    setBusy(true)
    void shareApi
      .revokeShare(ref, g.granteeUserId)
      .then(ok => {
        if (ok) refresh()
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="share-panel">
      <div className="share-panel__grant">
        <div className="share-panel__search">
          <input
            className="share-panel__input"
            type="text"
            placeholder="Share with… (type a display name)"
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              setPicked(null)
            }}
            aria-label="Grantee display name"
          />
          {results.length > 0 && !picked && (
            <ul className="share-panel__results" role="listbox">
              {results.map(u => (
                <li key={u.name}>
                  <button
                    type="button"
                    className="share-panel__result"
                    onClick={() => {
                      setPicked(u)
                      setQuery(u.name)
                      setResults([])
                    }}
                  >
                    <span className="share-panel__result-name">{u.name}</span>
                    {u.tier && <span className="share-panel__result-tier">{u.tier}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <select
          className="share-panel__level"
          value={level}
          onChange={e => setLevel(e.target.value as ShareLevel)}
          aria-label="Access level"
        >
          <option value="contributor">Contributor</option>
          <option value="readonly">Read-only</option>
        </select>

        <button
          className="share-panel__grant-btn"
          onClick={grant}
          disabled={!picked || busy}
          title={picked ? `Share with ${picked.name}` : 'Pick a real display name first'}
        >
          Share
        </button>
      </div>

      {msg && <p className={`share-panel__msg is-${msg.kind}`}>{msg.text}</p>}

      {grantees.length > 0 && (
        <ul className="share-panel__grantees">
          {grantees.map(g => (
            <li key={g.granteeUserId} className="share-panel__grantee">
              <span className="share-panel__grantee-name">
                {g.name ?? `${g.granteeUserId.slice(0, 8)}…`}
                {g.tier && <span className="share-panel__grantee-tier">{g.tier}</span>}
              </span>
              <span className="share-panel__grantee-level">{g.level}</span>
              <button
                className="share-panel__revoke"
                onClick={() => revoke(g)}
                disabled={busy}
                title={`Revoke ${g.name ?? 'access'}`}
                aria-label={`Revoke ${g.name ?? g.granteeUserId}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
