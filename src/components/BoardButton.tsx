/**
 * BoardButton component - renders a single board button with long-press support
 */

import React from 'react'
import { useLongPress } from '../hooks/useLongPress'
import { getTaskIdsFromDragEvent } from '../utils/dragDrop'
import type { Board } from '../domain/types'

interface BoardButtonProps {
  board: Board
  isActive: boolean
  isDragOver: boolean
  onSwitch: (boardId: string) => void
  onContextMenu: (boardId: string, x: number, y: number) => void
  onDragOverFilter: (filter: string | null) => void
  onMoveTasksToBoard: (boardId: string, taskIds: string[]) => Promise<boolean>
  /** Keep drag teardown from clearing the selection while the move is pending. */
  onHoldSelection: () => void
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
  onHoldSelection,
  onClearSelection
}: BoardButtonProps) {
  const longPressHandlers = useLongPress({
    onLongPress: (x, y) => onContextMenu(board.id, x, y)
  })

  const isMainBoard = board.id === 'main'

  return (
    <button
      className={`pill-btn board-btn ${isActive ? 'pill-btn--active board-btn--active' : ''} ${isDragOver ? 'board-btn--drag-over' : ''}`}
      onClick={() => onSwitch(board.id)}
      onContextMenu={e => {
        e.preventDefault()
        if (isMainBoard) return // Don't allow deleting main board
        onContextMenu(board.id, e.clientX, e.clientY)
      }}
      {...(isMainBoard ? {} : longPressHandlers)}
      aria-pressed={isActive}
      onDragOver={e => {
        // Indicate this board can accept drops
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOverFilter(`board:${board.id}`)
      }}
      onDragLeave={_e => {
        onDragOverFilter(null)
      }}
      onDrop={async e => {
        e.preventDefault()
        onDragOverFilter(null)
        const ids = getTaskIdsFromDragEvent(e.dataTransfer)
        if (ids.length === 0) return
        // The selection is settled HERE, once the move resolves: cleared when it
        // landed, kept when it failed (the hook has already reported that as a
        // toast) so a retry needs no re-selecting every card (#85). Held first,
        // synchronously, or drag teardown clears it before the move is known.
        onHoldSelection()
        if (await onMoveTasksToBoard(board.id, ids)) onClearSelection()
      }}
    >
      {board.name}
    </button>
  )
}
