/**
 * BoardsSection component
 * Displays the board list, the add-board button, and the edit-boards button.
 */

import React from 'react'
import { BoardButton } from './BoardButton'
import { getTaskIdsFromDragEvent } from '../utils/dragDrop'
import type { BoardsFile } from '../domain/types'
import type { PendingTaskOperation } from '../hooks/useModalState'
import { TOPBAR_BOARD_SLOTS } from '../app/constants'
import { effectivePinnedIds } from '../domain/utils/boardPins'
import { Icon } from '@wolffm/themes'

export interface BoardsSectionProps {
  boards: BoardsFile | null
  currentBoardId: string
  dragOverFilter: string | null
  onBoardSwitch: (boardId: string) => void
  onBoardContextMenu: (boardId: string, x: number, y: number) => void
  onDragOverFilter: (filter: string | null) => void
  onMoveTasksToBoard: (boardId: string, taskIds: string[]) => Promise<void>
  onClearSelection: () => void
  onCreateBoardClick: () => void
  onEditBoardsClick: () => void
  onPendingOperation: (op: PendingTaskOperation | null) => void
}

export function BoardsSection({
  boards,
  currentBoardId,
  dragOverFilter,
  onBoardSwitch,
  onBoardContextMenu,
  onDragOverFilter,
  onMoveTasksToBoard,
  onClearSelection,
  onCreateBoardClick,
  onEditBoardsClick,
  onPendingOperation
}: BoardsSectionProps) {
  // The top bar shows the pinned boards (server-ordered by position), capped at
  // TOPBAR_BOARD_SLOTS. Before a user has pinned anything, fall back to the first
  // N in server order so existing users don't get an empty bar. The active board
  // is always surfaced even when it's unpinned (reached via the picker).
  const allBoards =
    boards && boards.boards && boards.boards.length
      ? boards.boards
      : [{ id: 'main', name: 'main', tasks: [], tags: [] }]

  // Automation boards live on their own row below the standard boards, so an
  // agent board is distinguishable at a glance without a badge/emoji.
  const standardBoards = allBoards.filter(b => b.mode !== 'automation')
  const automationBoards = allBoards.filter(b => b.mode === 'automation')

  // Top bar shows the favorited standard boards (server-ordered), capped at the
  // slot count. Before anyone has favorited anything, the first N are favorited
  // by default (effectivePinnedIds) — same set the Edit Boards toggle sees, so
  // the two never disagree. The active board is always surfaced when it's a
  // standard board reached via the picker.
  const pinnedIds = new Set(effectivePinnedIds(allBoards, TOPBAR_BOARD_SLOTS))
  const topBar = standardBoards.filter(b => pinnedIds.has(b.id)).slice(0, TOPBAR_BOARD_SLOTS)
  const boardsList =
    topBar.some(b => b.id === currentBoardId) || automationBoards.some(b => b.id === currentBoardId)
      ? topBar
      : [...topBar, ...standardBoards.filter(b => b.id === currentBoardId)]

  // The server never capped board count; creation is always available now.
  const canAddMoreBoards = true

  const renderBoard = (b: (typeof allBoards)[number]) => (
    <BoardButton
      key={b.id}
      board={b}
      isActive={currentBoardId === b.id}
      isDragOver={dragOverFilter === `board:${b.id}`}
      onSwitch={onBoardSwitch}
      onContextMenu={onBoardContextMenu}
      onDragOverFilter={onDragOverFilter}
      onMoveTasksToBoard={onMoveTasksToBoard}
      onClearSelection={onClearSelection}
    />
  )

  return (
    <div className="task-app__boards">
      {/* Main row: the favorited standard boards + the create/edit actions. */}
      <div className="task-app__board-row">
        <div className="task-app__board-list">{boardsList.map(renderBoard)}</div>

        <div className="task-app__board-actions">
          {canAddMoreBoards && (
            <button
              className={`board-add-btn ${dragOverFilter === 'add-board' ? 'board-btn--drag-over' : ''}`}
              onClick={onCreateBoardClick}
              onDragOver={e => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                onDragOverFilter('add-board')
              }}
              onDragLeave={() => onDragOverFilter(null)}
              onDrop={e => {
                e.preventDefault()
                onDragOverFilter(null)

                const ids = getTaskIdsFromDragEvent(e.dataTransfer)
                if (ids.length > 0) {
                  onPendingOperation({ type: 'move-to-board', taskIds: ids })
                  onCreateBoardClick()
                }
              }}
              aria-label="Create board"
            >
              ＋
            </button>
          )}

          <button
            className="board-edit-btn"
            onClick={onEditBoardsClick}
            title="Edit boards"
            aria-label="Edit boards"
          >
            <Icon name="gear" />
          </button>
        </div>
      </div>

      {/* Second row, below the main one: automation boards on their own line. */}
      {automationBoards.length > 0 && (
        <div className="task-app__board-list task-app__board-list--automation">
          {automationBoards.map(renderBoard)}
        </div>
      )}
    </div>
  )
}
