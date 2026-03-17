/**
 * BoardContextMenu component
 * Context menu for board actions
 */

import React from 'react'
import { ContextMenu, logger } from '@wolffm/task-ui-components'
import type { BoardsFile } from '../../domain/types'
import { formatError } from '../../domain/utils/tags'

export interface BoardContextMenuProps {
  isOpen: boolean
  boardId: string | null
  x: number
  y: number
  boards: BoardsFile | null
  onClose: () => void
  onDeleteBoard: (boardId: string) => Promise<void>
}

export function BoardContextMenu({
  isOpen,
  boardId,
  x,
  y,
  boards,
  onClose,
  onDeleteBoard
}: BoardContextMenuProps) {
  const handleDelete = async () => {
    if (!boardId) return

    const boardName = boards?.boards?.find(b => b.id === boardId)?.name || boardId
    if (
      confirm(`Delete board "${boardName}"? All tasks on this board will be permanently deleted.`)
    ) {
      try {
        await onDeleteBoard(boardId)
        onClose()
      } catch (err) {
        logger.error('[BoardContextMenu] Failed to delete board', {
          error: formatError(err),
          boardId
        })
        alert((err as Error).message || 'Failed to delete board')
      }
    }
  }

  return (
    <ContextMenu
      isOpen={isOpen}
      x={x}
      y={y}
      className="board-context-menu"
      items={[
        {
          label: '🗑️ Delete Board',
          isDanger: true,
          onClick: handleDelete
        }
      ]}
    />
  )
}
