/**
 * BoardContextMenu component
 * Context menu for board actions
 */

import React, { useState } from 'react'
import { ContextMenu } from '@wolffm/task-ui-components'
import { logger } from '@wolffm/logger/client'
import type { BoardsFile } from '../../domain/types'
import { formatError } from '../../domain/utils/tags'
import { Icon } from '@wolffm/themes'
import { ConfirmModal } from './ConfirmModal'

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
  // The board the confirm is asking about. Captured on menu click, because
  // the menu closes as soon as the confirm opens and `boardId` goes null.
  const [pending, setPending] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const askDelete = () => {
    if (!boardId) return
    const name = boards?.boards?.find(b => b.id === boardId)?.name || boardId
    setError(null)
    setPending({ id: boardId, name })
    onClose()
  }

  const confirmDelete = async () => {
    if (!pending) return
    try {
      await onDeleteBoard(pending.id)
      setPending(null)
    } catch (err) {
      logger.error('[BoardContextMenu] Failed to delete board', {
        error: formatError(err),
        boardId: pending.id
      })
      // Stays in the dialog rather than going to alert(), which the same
      // browser setting that broke the confirm also suppresses.
      setError((err as Error).message || 'Failed to delete board')
    }
  }

  return (
    <>
      <ContextMenu
        isOpen={isOpen}
        x={x}
        y={y}
        className="board-context-menu"
        items={[
          {
            label: (
              <>
                <Icon name="trash" /> Delete Board
              </>
            ),
            isDanger: true,
            onClick: askDelete
          }
        ]}
      />

      <ConfirmModal
        isOpen={pending !== null}
        title="Delete board?"
        message={
          <>
            <strong>{pending?.name}</strong> and all tasks on it will be permanently deleted.
          </>
        }
        confirmLabel="Delete board"
        error={error}
        onCancel={() => {
          setPending(null)
          setError(null)
        }}
        onConfirm={confirmDelete}
      />
    </>
  )
}
