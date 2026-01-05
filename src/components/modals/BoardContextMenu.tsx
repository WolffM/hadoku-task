/**
 * BoardContextMenu component
 * Context menu for board actions
 */

import React from 'react'
import { ContextMenu } from '../ContextMenu'
import type { BoardsFile } from '../../domain/types'
import { formatError } from '../../domain/utils/tags'
import { logger } from '@wolffm/task-ui-components'

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
