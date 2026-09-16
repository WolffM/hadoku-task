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
import { ConfirmModal } from './ConfirmModal'

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
  /** Report a failure to the user (a toast). See ConfirmModal on why not alert(). */
  onError: (message: string) => void
}

const isOwned = (b: Board): boolean => !b.access || b.access === 'owner'

/**
 * What a row's destructive action IS. Owned boards are deleted, boards shared
 * with you are left, and `main` is neither — it cannot be removed at all, which
 * is why this returns null rather than a disabled 'delete'.
 *
 * Selection, the bulk bar and the confirmation dialog all key off this one
 * function, so a row can never offer a checkbox for an action its button does
 * not have.
 */
type ActionKind = 'delete' | 'leave'

const actionFor = (b: Board): ActionKind | null => {
  if (!isOwned(b)) return 'leave'
  return b.id === 'main' ? null : 'delete'
}

/** Both verbs, in every form the UI needs them. One place to read them from. */
const VERB: Record<ActionKind, { button: string; title: string; bulk: (n: number) => string }> = {
  delete: {
    button: 'Delete board',
    title: 'Delete board?',
    bulk: n => `Delete ${n} board${n === 1 ? '' : 's'}`
  },
  leave: {
    button: 'Leave board',
    title: 'Leave shared board?',
    bulk: n => `Leave ${n} board${n === 1 ? '' : 's'}`
  }
}

/**
 * A destructive action waiting on its confirmation dialog.
 *
 * ALWAYS a list, even for the single row button — one path to confirm, one to
 * execute, one to report. A batch is not a second code path with its own bugs.
 */
interface PendingAction {
  kind: ActionKind
  boards: Board[]
}

type Selection = Record<ActionKind, Set<string>>

const EMPTY_SELECTION: Selection = { delete: new Set(), leave: new Set() }

/** How many names the dialog spells out before it starts counting instead. */
const NAMES_SHOWN = 6

function confirmTitle({ kind, boards }: PendingAction): string {
  if (boards.length === 1) return VERB[kind].title
  return kind === 'delete' ? `Delete ${boards.length} boards?` : `Leave ${boards.length} boards?`
}

/**
 * Name what is about to go. A bulk confirm that only says "3 boards" asks the
 * user to trust a count they cannot check — and the whole reason this dialog
 * exists is that the batch is irreversible.
 */
function confirmMessage({ kind, boards }: PendingAction): React.ReactNode {
  const shown = boards.slice(0, NAMES_SHOWN)
  const rest = boards.length - shown.length
  const names = (
    <>
      {shown.map((b, i) => (
        <React.Fragment key={b.id}>
          {i > 0 && ', '}
          <strong>{b.name}</strong>
        </React.Fragment>
      ))}
      {rest > 0 && ` and ${rest} more`}
    </>
  )

  if (kind === 'leave') {
    return (
      <>
        You will lose access to {names}. The owner can share {boards.length === 1 ? 'it' : 'them'}{' '}
        with you again.
      </>
    )
  }
  return (
    <>
      {names} and all {boards.length === 1 ? 'its' : 'their'} tasks will be permanently deleted.
    </>
  )
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
  shareApi,
  onReloadBoards,
  validateBoardName,
  onError
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
  // Destructive actions confirm through a dialog this app renders, NOT through
  // window.confirm — a browser told to stop prompting for this page returns
  // false from confirm() without showing anything, which turned Delete into a
  // dead button with no way back short of clearing site settings.
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  // Checked rows, kept per verb. Deleting boards you own and leaving boards
  // someone shared with you are different consequences, so they never end up in
  // one ambiguous "3 selected" that could mean either.
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION)

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

  // ── Selection ──────────────────────────────────────────────────────────
  // Keyed by board ID, not by index: the list re-sorts on pin and re-filters on
  // search, and a selection addressed by position would silently follow the row
  // that moved into the slot.

  const toggleSelected = (kind: ActionKind, id: string) =>
    setSelection(prev => {
      const next = new Set(prev[kind])
      if (!next.delete(id)) next.add(id)
      return { ...prev, [kind]: next }
    })

  const clearSelected = (kind: ActionKind) =>
    setSelection(prev => (prev[kind].size ? { ...prev, [kind]: new Set<string>() } : prev))

  /**
   * Resolve a selection back to boards, in the order they are shown.
   *
   * Reads from `boards`, NOT from the filtered list: a board selected before the
   * user typed in the search box is still selected, and must still be acted on.
   * It also drops IDs that no longer exist, so a board deleted in another tab
   * cannot leave a phantom in the count.
   */
  const selectedBoards = (kind: ActionKind) =>
    boards.filter(b => selection[kind].has(b.id) && actionFor(b) === kind)

  const ask = (kind: ActionKind, targets: Board[]) => {
    if (targets.length === 0) return
    setPendingAction({ kind, boards: targets })
  }

  /**
   * Run the confirmed action over every target, then repaint once.
   *
   * SEQUENTIAL, and it keeps going after a failure. Each delete ends in a
   * reload, and those reloads share a sequence guard that discards superseded
   * results — firing them concurrently would leave the last one to win by
   * timing. Going one at a time also means a board that fails is the only one
   * reported, instead of the whole batch dying on the first error with the rest
   * in an unknown state.
   */
  const runPendingAction = async () => {
    const action = pendingAction
    if (!action) return
    setPendingAction(null)

    const failed: Board[] = []
    await run(async () => {
      for (const board of action.boards) {
        try {
          if (action.kind === 'delete') await onDelete(board.id)
          else await shareApi.revokeShare(boardRef(board), 'me')
        } catch {
          failed.push(board)
        }
      }
    })

    // Exactly the boards that failed stay checked, so a retry is one more click
    // on the bulk button rather than hunting them back out of the list.
    setSelection(prev => ({ ...prev, [action.kind]: new Set(failed.map(b => b.id)) }))

    if (failed.length) {
      const verb = action.kind === 'delete' ? 'delete' : 'leave'
      const names = failed.map(b => b.name)
      onError(
        names.length === 1
          ? `Could not ${verb} "${names[0]}"`
          : `Could not ${verb} ${names.length} boards: ${names.join(', ')}`
      )
    }
  }

  /**
   * Select-all plus the bulk action, for one group.
   *
   * Only rendered when the group has at least two actionable rows: with one,
   * the row's own button already is the bulk action, and a bar above it is
   * noise. Hidden entirely while a row is being renamed, so the bar cannot
   * steal the click that commits the edit.
   */
  const renderBulkBar = (kind: ActionKind, rows: Board[]) => {
    const actionable = rows.filter(b => actionFor(b) === kind)
    const chosen = selectedBoards(kind)
    // Against the WHOLE group, not the filtered rows: "all" has to mean all, or
    // a search would quietly turn select-all into select-some.
    const allOfGroup = boards.filter(b => actionFor(b) === kind)

    // A live selection ALWAYS keeps its bar, even when a search has filtered the
    // selected rows off screen — otherwise the only control that can act on it,
    // or clear it, disappears and the selection is stranded.
    if (allOfGroup.length < 2 && chosen.length === 0) return null

    const allChosen = chosen.length === allOfGroup.length && allOfGroup.length > 0
    const hidden = chosen.length - actionable.filter(b => selection[kind].has(b.id)).length

    return (
      <div className="edit-boards__bulk">
        <label className="edit-boards__bulk-all">
          <input
            type="checkbox"
            className="edit-boards__check"
            checked={allChosen}
            ref={el => {
              // Some-but-not-all is its own state, and a plain checked/unchecked
              // box cannot show it — the box would read "none selected" while
              // three are.
              if (el) el.indeterminate = chosen.length > 0 && !allChosen
            }}
            onChange={() =>
              setSelection(prev => ({
                ...prev,
                [kind]: allChosen ? new Set<string>() : new Set(allOfGroup.map(b => b.id))
              }))
            }
            disabled={busy}
            aria-label={`Select all boards to ${kind}`}
          />
          <span>Select all</span>
        </label>

        {chosen.length > 0 && (
          <div className="edit-boards__bulk-actions">
            <span className="edit-boards__bulk-count">
              {chosen.length} selected
              {/* A count that does not match what is on screen needs saying, or
                  it reads as a bug in the search. */}
              {hidden > 0 && (
                <span className="edit-boards__bulk-hidden"> ({hidden} not shown)</span>
              )}
            </span>
            <button
              className={`edit-boards__bulk-btn${kind === 'delete' ? ' is-danger' : ''}`}
              onClick={() => ask(kind, chosen)}
              disabled={busy}
            >
              {VERB[kind].bulk(chosen.length)}
            </button>
            <button
              className="edit-boards__bulk-clear"
              onClick={() => clearSelected(kind)}
              disabled={busy}
            >
              Clear
            </button>
          </div>
        )}
      </div>
    )
  }

  const renderRow = (b: Board) => {
    const isPinned = pinnedSet.has(b.id)
    const isMain = b.id === 'main'
    const owns = isOwned(b)
    const kind = actionFor(b)
    const draggable = isPinned && !editingId
    return (
      <React.Fragment key={b.id}>
        <li
          className={[
            'edit-boards__row',
            'hdk-advanced-surface',
            'hdk-advanced-surface--shift',
            b.id === currentBoardId ? 'is-current' : '',
            kind && selection[kind].has(b.id) ? 'is-selected' : '',
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

          {kind ? (
            <input
              type="checkbox"
              className="edit-boards__check"
              checked={selection[kind].has(b.id)}
              onChange={() => toggleSelected(kind, b.id)}
              disabled={busy}
              aria-label={`Select ${b.name}`}
            />
          ) : (
            // `main` has no destructive action, so it gets no checkbox — and a
            // spacer, or its row's columns would not line up with the rest.
            <span className="edit-boards__check edit-boards__check--empty" aria-hidden="true" />
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
                    onClick={() => ask('delete', [b])}
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
                onClick={() => ask('leave', [b])}
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

      {renderBulkBar('delete', owned)}
      <ul className="edit-boards__list">{owned.map(renderRow)}</ul>

      {shared.length > 0 && (
        <>
          <p className="edit-boards__group-label">Shared with me</p>
          {renderBulkBar('leave', shared)}
          <ul className="edit-boards__list">{shared.map(renderRow)}</ul>
        </>
      )}

      <ConfirmModal
        isOpen={pendingAction !== null}
        title={pendingAction ? confirmTitle(pendingAction) : ''}
        message={pendingAction ? confirmMessage(pendingAction) : null}
        confirmLabel={
          pendingAction
            ? pendingAction.boards.length === 1
              ? VERB[pendingAction.kind].button
              : VERB[pendingAction.kind].bulk(pendingAction.boards.length)
            : ''
        }
        onCancel={() => setPendingAction(null)}
        onConfirm={runPendingAction}
      />
    </Modal>
  )
}
