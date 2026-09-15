/**
 * TagContextMenu component
 * Context menu for tag actions
 */

import React from 'react'
import { ContextMenu } from '@wolffm/task-ui-components'
import { logger } from '@wolffm/logger/client'
import { formatError } from '../../domain/utils/tags'
import { Icon } from '@wolffm/themes'

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
      // Defensive only: useTasks' deleteTag reports its own failures (as a
      // toast) and resolves, so this branch does not fire on the live wiring.
      // Never an alert() — a browser told to stop prompting for this page
      // silently drops it.
      logger.error('[TagContextMenu] Failed to delete tag', {
        error: formatError(err),
        tag
      })
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
          label: (
            <>
              <Icon name="trash" /> Delete Tag
            </>
          ),
          isDanger: true,
          onClick: handleDelete
        }
      ]}
    />
  )
}
