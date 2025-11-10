/**
 * ContextMenu Component
 * Generic context menu with position-based rendering
 */

import React from 'react'

export interface ContextMenuItem {
  label: string
  onClick: () => void | Promise<void>
  isDanger?: boolean
  disabled?: boolean
}

export interface ContextMenuProps {
  isOpen: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  className?: string
}

export function ContextMenu({ isOpen, x, y, items, className = 'context-menu' }: ContextMenuProps) {
  if (!isOpen) return null

  return (
    <div
      className={className}
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        zIndex: 1000
      }}
    >
      {items.map((item, index) => (
        <button
          key={index}
          className={`context-menu-item ${item.isDanger ? 'context-menu-item--danger' : ''}`}
          onClick={item.onClick}
          disabled={item.disabled}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
