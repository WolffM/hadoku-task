/**
 * BoardsSection component
 * Displays board list, add board button, and sync button
 */

import React, { useState } from 'react'
import { BoardButton } from './BoardButton'
import { getTaskIdsFromDragEvent } from '../utils/dragDrop'
import type { BoardsFile } from '../domain/types'
import type { PendingTaskOperation } from '../hooks/useModalState'
import { TOPBAR_BOARD_SLOTS } from '../app/constants'
import { formatError } from '../domain/utils/tags'
import { logger } from '@wolffm/logger/client'

export interface BoardsSectionProps {
  boards: BoardsFile | null
  currentBoardId: string
  userType: string
  dragOverFilter: string | null
  onBoardSwitch: (boardId: string) => void
  onBoardContextMenu: (boardId: string, x: number, y: number) => void
  onDragOverFilter: (filter: string | null) => void
  onMoveTasksToBoard: (boardId: string, taskIds: string[]) => Promise<void>
  onClearSelection: () => void
  onCreateBoardClick: () => void
  onEditBoardsClick: () => void
  onPendingOperation: (op: PendingTaskOperation | null) => void
  onInitialLoad: () => Promise<void>
  onShowToast?: (message: string, type?: 'success' | 'error' | 'info') => void
}

export function BoardsSection({
  boards,
  currentBoardId,
  userType,
  dragOverFilter,
  onBoardSwitch,
  onBoardContextMenu,
  onDragOverFilter,
  onMoveTasksToBoard,
  onClearSelection,
  onCreateBoardClick,
  onEditBoardsClick,
  onPendingOperation,
  onInitialLoad,
  onShowToast
}: BoardsSectionProps) {
  const [isSyncing, setIsSyncing] = useState(false)

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

  const handleSyncClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isSyncing) return

    logger.info('[BoardsSection] Manual refresh triggered')
    setIsSyncing(true)

    const button = e.currentTarget
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Sync timeout')), 5000)
    })

    try {
      await Promise.race([onInitialLoad(), timeoutPromise])
      logger.info('[BoardsSection] Sync completed successfully')
      onShowToast?.('Refresh successful', 'success')
    } catch (error) {
      logger.error('[BoardsSection] Sync failed', {
        error: formatError(error)
      })
      onShowToast?.('Refresh failed', 'error')
    } finally {
      setIsSyncing(false)
      button?.blur()
    }
  }

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

        {userType !== 'public' && (
          <button
            className={`sync-btn ${isSyncing ? 'spinning' : ''}`}
            onClick={handleSyncClick}
            disabled={isSyncing}
            title="Sync from server"
            aria-label="Sync from server"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
