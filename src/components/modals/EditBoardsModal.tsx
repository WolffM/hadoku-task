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
import { effectivePinnedIds } from '../../domain/utils/boardPins'
import { TOPBAR_BOARD_SLOTS } from '../../app/constants'
import { ShareIcon } from '../ShareIcon'

export type ShareLevel = 'readonly' | 'contributor'

export interface ShareRow {
  granteeUserId: string
  name?: string | null
  tier?: string | null
  level: string
  createdAt: string
}

/** A preview row from an activation dryRun (tag → where it lands). */
export interface ActivationMappingRow {
  tag: string
  count: number
  lands: 'lane' | 'inbox'
}
export interface ActivationPreview {
  digest: string
  lanes: Array<Record<string, unknown>>
  mapping: ActivationMappingRow[]
  toInbox: number
  collisions: string[]
}

/** Server-only owner board operations (share + automation), injected from the client. */
export interface ShareApi {
  searchUsers: (q: string) => Promise<Array<{ name: string; tier?: string }>>
  listShares: (boardRef: string) => Promise<ShareRow[]>
  grantShare: (
    boardRef: string,
    input: { name?: string; userId?: string; level: ShareLevel }
  ) => Promise<{
    ok: boolean
    error?: string
    granted?: { name: string | null; tier: string | null; level: string }
  }>
  revokeShare: (boardRef: string, granteeUserId: string) => Promise<boolean>
  activateAutomation: (
    boardRef: string,
    payload: {
      lanes: unknown
      schemaId?: string | null
      schemaVersion?: number | null
      repo?: string | null
      dryRun?: boolean
      digest?: string
    }
  ) => Promise<{ ok: boolean; error?: string; code?: string; result?: unknown }>
  deactivateAutomation: (boardRef: string) => Promise<{ ok: boolean; error?: string }>
  validateRepo: (
    repo: string
  ) => Promise<{
    repo: string
    valid: boolean
    reason: string
    private?: boolean
    defaultBranch?: string
    message?: string
  }>
  setRepo: (boardRef: string, repo: string) => Promise<{ ok: boolean; repo?: string | null }>
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
  /** Reload boards from the server (after activate/deactivate changes a board's mode). */
  onReloadBoards: () => Promise<void>
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
                  🤖
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
  // Seed from the grantees GET /boards already hydrated, so the list is on
  // screen the instant the panel opens (no fetch-on-open flash / silent empty).
  const [grantees, setGrantees] = useState<ShareRow[]>(() => board.shares ?? [])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeq = useRef(0)

  // Re-read the grantee list from the server (after a grant/revoke). The client's
  // listShares reports EVERY failure as an empty array, so an empty reply is
  // ambiguous — never let one blank out a list we already have, or a transient
  // hiccup reads as "shared with nobody". An add/remove we just made is reflected
  // by the caller updating state directly.
  const refresh = useCallback(() => {
    void shareApi.listShares(ref).then(rows => {
      setGrantees(prev => (rows.length === 0 && prev.length > 0 ? prev : rows))
    })
  }, [shareApi, ref])

  // Grantees normally arrive hydrated on the board (GET /boards). Only fetch when
  // they didn't — an older payload, or a board the hydration skipped.
  useEffect(() => {
    if (board.shares === undefined) refresh()
  }, [refresh, board.shares])

  // Keep in step if a board reload brings a fresh grantee list.
  useEffect(() => {
    if (board.shares) setGrantees(board.shares)
  }, [board.shares])

  // Debounced autocomplete. A pick sets query to the picked name; typing again
  // re-opens. A sequence guard drops out-of-order responses (the search scan can
  // be slow), so a stale slow reply never clobbers the latest results.
  useEffect(() => {
    const q = query.trim()
    // Don't re-search the exact text we just picked.
    if (picked && picked.name === q) return
    if (debounce.current) clearTimeout(debounce.current)
    if (!q) {
      setResults([])
      return
    }
    const mySeq = ++searchSeq.current
    debounce.current = setTimeout(() => {
      void shareApi.searchUsers(q).then(users => {
        if (mySeq === searchSeq.current) setResults(users)
      })
    }, 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [query, picked, shareApi])

  // The grantee is a click-picked result, OR an exact (case-insensitive) match
  // for the typed text — so typing the full name and hitting Share also works,
  // without needing a precise click on the dropdown.
  const qLower = query.trim().toLowerCase()
  const effectivePick = picked ?? results.find(u => u.name.toLowerCase() === qLower) ?? null

  const grant = () => {
    if (!effectivePick || busy) return
    const target = effectivePick
    setBusy(true)
    setMsg(null)
    void shareApi
      .grantShare(ref, { name: target.name, level })
      .then(res => {
        if (res.ok) {
          setMsg({
            kind: 'ok',
            text: `Shared with ${res.granted?.name ?? target.name} (${res.granted?.tier ?? '—'})`
          })
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
        if (!ok) return
        // Drop the row locally: revoking the LAST grantee legitimately yields an
        // empty list, which refresh()'s guard would otherwise mistake for a
        // failed fetch and keep showing the person we just removed.
        setGrantees(prev => prev.filter(x => x.granteeUserId !== g.granteeUserId))
        refresh()
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
          disabled={!effectivePick || busy}
          title={
            effectivePick ? `Share with ${effectivePick.name}` : 'Pick a real display name first'
          }
        >
          Share
        </button>
      </div>

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

/**
 * Convert a board to (or off) an automation board (§5.4). Activation is a
 * DESTRUCTIVE migration: paste a provider's activation JSON (the lane contract),
 * preview the tag→lane mapping via a dryRun, then commit by echoing the digest.
 * An automation board shows its lanes + a Deactivate action.
 */
function AutomationPanel({
  board,
  shareApi,
  onDone
}: {
  board: Board
  shareApi: ShareApi
  onDone: () => Promise<void>
}) {
  const ref = boardRef(board)
  const isAutomation = board.mode === 'automation'
  const [raw, setRaw] = useState('')
  const [preview, setPreview] = useState<ActivationPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [repo, setRepo] = useState((board.repo as string | undefined) ?? '')
  const [repoStatus, setRepoStatus] = useState<{
    valid: boolean
    private?: boolean
    defaultBranch?: string
    message?: string
  } | null>(null)
  const [repoChecking, setRepoChecking] = useState(false)

  // Validate against GitHub, then AUTO-SAVE on success — no separate button.
  // Clearing the field (empty on blur) clears the saved repo.
  const checkRepo = () => {
    const r = repo.trim()
    setRepoStatus(null)
    if (!r) {
      if ((board.repo as string | undefined) ?? '') void shareApi.setRepo(ref, '')
      return
    }
    setRepoChecking(true)
    void shareApi
      .validateRepo(r)
      .then(res => {
        setRepoStatus(res)
        if (res.valid) void shareApi.setRepo(ref, r)
      })
      .finally(() => setRepoChecking(false))
  }

  // Parse the pasted JSON into an activation payload (lanes + opaque labels + repo).
  const parsePayload = (): {
    lanes: unknown
    schemaId?: string
    schemaVersion?: number
    repo?: string
  } | null => {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>
      const lanes = Array.isArray(obj.lanes) ? obj.lanes : Array.isArray(obj) ? obj : null
      if (!lanes) {
        setErr('JSON must have a `lanes` array (or be a lane array).')
        return null
      }
      return {
        lanes,
        schemaId: typeof obj.schemaId === 'string' ? obj.schemaId : undefined,
        schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : undefined,
        repo: typeof obj.repo === 'string' ? obj.repo : undefined
      }
    } catch {
      setErr('That is not valid JSON.')
      return null
    }
  }

  const runPreview = () => {
    setErr(null)
    setPreview(null)
    const payload = parsePayload()
    if (!payload) return
    setBusy(true)
    void shareApi
      .activateAutomation(ref, { ...payload, dryRun: true })
      .then(res => {
        if (res.ok) setPreview((res.result as { preview: ActivationPreview }).preview)
        else setErr(res.error ?? 'Preview failed')
      })
      .finally(() => setBusy(false))
  }

  const commit = () => {
    const payload = parsePayload()
    if (!payload || !preview) return
    setBusy(true)
    setErr(null)
    void shareApi
      .activateAutomation(ref, { ...payload, digest: preview.digest })
      .then(async res => {
        if (res.ok) await onDone()
        else setErr(res.error ?? 'Activation failed')
      })
      .finally(() => setBusy(false))
  }

  const deactivate = () => {
    if (
      !window.confirm(
        `Deactivate automation on "${board.name}"? Tasks keep their tags; the lane lock is removed.`
      )
    )
      return
    setBusy(true)
    setErr(null)
    void shareApi
      .deactivateAutomation(ref)
      .then(async res => {
        if (res.ok) await onDone()
        else setErr(res.error ?? 'Deactivation failed')
      })
      .finally(() => setBusy(false))
  }

  // The repo field is shared by both views. It validates against GitHub on blur
  // and AUTO-SAVES on success (repo drives the board → checkout mapping, §5.5).
  const repoField = (
    <div className="automation-panel__repo">
      <input
        className="automation-panel__repo-input"
        type="text"
        placeholder="Repo (owner/name), e.g. WolffM/my-repo"
        value={repo}
        onChange={e => {
          setRepo(e.target.value)
          setRepoStatus(null)
        }}
        onBlur={checkRepo}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        aria-label="Repo"
      />
      {repoChecking && <span className="automation-panel__repo-status is-checking">checking…</span>}
      {!repoChecking && repoStatus?.valid && (
        <span className="automation-panel__repo-status is-ok">
          ✓ saved · {repoStatus.private ? 'private' : 'public'}
          {repoStatus.defaultBranch ? ` · ${repoStatus.defaultBranch}` : ''}
        </span>
      )}
      {!repoChecking && repoStatus && !repoStatus.valid && (
        <span className="automation-panel__repo-status is-bad" title={repoStatus.message}>
          ✗ {repoStatus.message ?? 'not found'}
        </span>
      )}
    </div>
  )

  if (isAutomation) {
    const lanes = (board.lanes ?? []) as Array<{ tag: string; label?: string; editableBy?: string }>
    return (
      <div className="share-panel automation-panel">
        <p className="automation-panel__status">
          <strong>Automation active</strong>
          {board.schemaId ? ` · ${board.schemaId} v${board.schemaVersion ?? '?'}` : ''} ·{' '}
          {lanes.length} lanes
        </p>

        {repoField}

        <ul className="automation-panel__lanes">
          {lanes.map(l => (
            <li key={l.tag} className="automation-panel__lane">
              <span className="automation-panel__lane-tag">{l.label ?? l.tag}</span>
              <span className={`automation-panel__lane-by is-${l.editableBy}`}>{l.editableBy}</span>
            </li>
          ))}
        </ul>
        {err && <p className="share-panel__msg is-err">{err}</p>}
        <button className="automation-panel__deactivate" onClick={deactivate} disabled={busy}>
          Deactivate automation
        </button>
      </div>
    )
  }

  return (
    <div className="share-panel automation-panel">
      <p className="automation-panel__hint">
        Convert this to an <strong>automation board</strong>: paste a provider&apos;s activation
        JSON (its lane contract). This is <strong>destructive</strong> — it replaces the
        board&apos;s tags with the fixed lanes. Preview first.
      </p>
      {repoField}

      <textarea
        className="automation-panel__json"
        placeholder={'{\n  "schemaId": "autoland",\n  "schemaVersion": 1,\n  "lanes": [ … ]\n}'}
        value={raw}
        onChange={e => {
          setRaw(e.target.value)
          setPreview(null)
          setErr(null)
        }}
        rows={4}
        aria-label="Activation JSON"
      />

      {err && <p className="share-panel__msg is-err">{err}</p>}

      {preview && (
        <div className="automation-panel__preview">
          <p className="automation-panel__preview-head">
            {preview.lanes.length} lanes · {preview.toInbox} task{preview.toInbox === 1 ? '' : 's'}{' '}
            → Inbox
            {preview.collisions.length > 0 ? ` · collisions: ${preview.collisions.join(', ')}` : ''}
          </p>
          {preview.mapping.length > 0 && (
            <ul className="automation-panel__mapping">
              {preview.mapping.map(m => (
                <li key={m.tag}>
                  <span className="automation-panel__map-tag">{m.tag}</span>
                  <span className="automation-panel__map-arrow">→</span>
                  <span className={`automation-panel__map-dest is-${m.lands}`}>
                    {m.lands === 'lane' ? m.tag : 'Inbox'} ({m.count})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="automation-panel__actions">
        <button
          className="automation-panel__preview-btn"
          onClick={runPreview}
          disabled={busy || !raw.trim()}
        >
          Preview
        </button>
        <button
          className="automation-panel__activate-btn"
          onClick={commit}
          disabled={busy || !preview}
          title={preview ? 'Activate (destructive)' : 'Preview first'}
        >
          Activate
        </button>
      </div>
    </div>
  )
}
