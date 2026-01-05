/**
 * TagContextMenu component
 * Context menu for tag actions
 */

import React from 'react'
import { ContextMenu } from '../ContextMenu'
import { formatError } from '../../domain/utils/tags'
import { logger } from '@wolffm/task-ui-components'

export interface TagContextMenuProps {
  isOpen: boolean
  tag: string | null
  x: number
  y: number
  onClose: () => void
  onDeleteTag: (tag: string) => Promise<void>
}

export function TagContextMenu({ isOpen, tag, x, y, onClose, onDeleteTag }: TagContextMenuProps) {
  const handleDelete = async () => {
    logger.info('[TagContextMenu] Delete Tag clicked', { tag })
    if (!tag) {
      logger.error('[TagContextMenu] No tag when Delete clicked')
      return
    }

    try {
      logger.info('[TagContextMenu] Calling deleteTag', { tag })
      await onDeleteTag(tag)
      logger.info('[TagContextMenu] deleteTag completed successfully', { tag })
      onClose()
    } catch (err) {
      logger.error('[TagContextMenu] Failed to delete tag', {
        error: formatError(err),
        tag
      })
      alert((err as Error).message || 'Failed to delete tag')
    }
  }

  return (
    <ContextMenu
      isOpen={isOpen}
      x={x}
      y={y}
      className="tag-context-menu"
      items={[
        {
          label: '🗑️ Delete Tag',
          isDanger: true,
          onClick: handleDelete
        }
      ]}
    />
  )
}
