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
  const pinned = allBoards.filter(b => b.pinned)
  const base = pinned.length > 0 ? pinned : allBoards
  const topBar = base.slice(0, TOPBAR_BOARD_SLOTS)
  const boardsList = topBar.some(b => b.id === currentBoardId)
    ? topBar
    : [...topBar, ...allBoards.filter(b => b.id === currentBoardId)]

  // The server never capped board count; creation is always available now.
  const canAddMoreBoards = true

  return (
    <div className="task-app__boards">
      <div className="task-app__board-list">
        {boardsList.map(b => (
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
        ))}
      </div>

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
          ⚙
        </button>
      </div>
    </div>
  )
}
