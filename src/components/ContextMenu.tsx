import React from 'react'

interface ContextMenuItem {
  label: string
  onClick: () => void | Promise<void>
  isDanger?: boolean
}

interface ContextMenuProps {
  isOpen: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  className?: string
}

export function ContextMenu({ isOpen, x, y, items, className = 'board-context-menu' }: ContextMenuProps) {
  if (!isOpen) return null

  return (
    <div 
      className={className}
      style={{
        left: `${x}px`,
        top: `${y}px`,
      }}
    >
      {items.map((item, index) => (
        <button
          key={index}
          className={`context-menu-item ${item.isDanger ? 'context-menu-item--danger' : ''}`}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
