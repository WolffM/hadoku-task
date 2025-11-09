/**
 * BoardButton component - renders a single board button with long-press support
 */

import React from 'react'
import { useLongPress } from '../hooks/useLongPress'
import { getTaskIdsFromDragEvent } from '../utils/dragDrop'
import type { Board } from '../domain/types'
import { logger } from '@wolffm/task-ui-components'

interface BoardButtonProps {
  board: Board
  isActive: boolean
  isDragOver: boolean
  onSwitch: (boardId: string) => void
  onContextMenu: (boardId: string, x: number, y: number) => void
  onDragOverFilter: (filter: string | null) => void
  onMoveTasksToBoard: (boardId: string, taskIds: string[]) => Promise<void>
  onClearSelection: () => void
}

export function BoardButton({
  board,
  isActive,
  isDragOver,
  onSwitch,
  onContextMenu,
  onDragOverFilter,
  onMoveTasksToBoard,
  onClearSelection
}: BoardButtonProps) {
  const longPressHandlers = useLongPress({
    onLongPress: (x, y) => onContextMenu(board.id, x, y)
  })

  const isMainBoard = board.id === 'main'

  return (
    <button
      className={`board-btn ${isActive ? 'board-btn--active' : ''} ${isDragOver ? 'board-btn--drag-over' : ''}`}
      onClick={() => onSwitch(board.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        if (isMainBoard) return // Don't allow deleting main board
        onContextMenu(board.id, e.clientX, e.clientY)
      }}
      {...(isMainBoard ? {} : longPressHandlers)}
      aria-pressed={isActive ? 'true' : 'false'}
      onDragOver={(e) => {
        // Indicate this board can accept drops
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOverFilter(`board:${board.id}`)
      }}
      onDragLeave={(e) => {
        onDragOverFilter(null)
      }}
      onDrop={async (e) => {
        e.preventDefault()
        onDragOverFilter(null)
        const ids = getTaskIdsFromDragEvent(e.dataTransfer)
        if (ids.length === 0) return
        try {
          await onMoveTasksToBoard(board.id, ids)
          try { onClearSelection() } catch {}
        } catch (err) {
          logger.error('[BoardButton] Failed moving tasks to board', {
            error: err instanceof Error ? err.message : String(err),
            boardId: board.id,
            taskCount: ids.length
          })
          alert((err as Error).message || 'Failed to move tasks')
        }
      }}
    >
      {board.name}
    </button>
  )
}
