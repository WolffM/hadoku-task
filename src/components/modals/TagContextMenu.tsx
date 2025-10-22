/**
 * TagContextMenu component
 * Context menu for tag actions
 */

import React from 'react'
import { ContextMenu } from '../ContextMenu'

export interface TagContextMenuProps {
  isOpen: boolean
  tag: string | null
  x: number
  y: number
  onClose: () => void
  onDeleteTag: (tag: string) => Promise<void>
}

export function TagContextMenu({
  isOpen,
  tag,
  x,
  y,
  onClose,
  onDeleteTag
}: TagContextMenuProps) {
  const handleDelete = async () => {
    console.log('[TagContextMenu] Delete Tag clicked!', { tag })
    if (!tag) {
      console.error('[TagContextMenu] No tag when Delete clicked!')
      return
    }
    
    try {
      console.log('[TagContextMenu] Calling deleteTag for tag:', tag)
      await onDeleteTag(tag)
      console.log('[TagContextMenu] deleteTag completed successfully')
      onClose()
    } catch (err) {
      console.error('[TagContextMenu] Failed to delete tag:', err)
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
