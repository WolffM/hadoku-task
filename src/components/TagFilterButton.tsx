/**
 * TagFilterButton component - renders a single tag filter button with long-press support
 */

import React from 'react'
import { useLongPress } from '../hooks/useLongPress'

interface TagFilterButtonProps {
  tag: string
  isActive: boolean
  isDragOver: boolean
  onToggle: (tag: string) => void
  onContextMenu: (tag: string, x: number, y: number) => void
  onDragOver: (e: React.DragEvent, tag: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, tag: string) => void
}

export function TagFilterButton({
  tag,
  isActive,
  isDragOver,
  onToggle,
  onContextMenu,
  onDragOver,
  onDragLeave,
  onDrop
}: TagFilterButtonProps) {
  const longPressHandlers = useLongPress({
    onLongPress: (x, y) => onContextMenu(tag, x, y)
  })

  return (
    <button
      onClick={() => onToggle(tag)}
      onContextMenu={e => {
        e.preventDefault()
        onContextMenu(tag, e.clientX, e.clientY)
      }}
      {...longPressHandlers}
      className={`${isActive ? 'on' : ''} ${isDragOver ? 'task-app__filter-drag-over' : ''}`}
      onDragOver={e => onDragOver(e, tag)}
      onDragLeave={onDragLeave}
      onDrop={e => onDrop(e, tag)}
    >
      #{tag}
    </button>
  )
}
