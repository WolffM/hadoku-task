/**
 * BentoGrid Component
 * Responsive grid container for bento-style card layouts
 * Automatically adjusts columns based on viewport size
 */

import React from 'react'

export type BentoColumns = 1 | 2 | 3 | 4 | 6

export interface BentoGridProps {
  children: React.ReactNode
  className?: string
  /** Column configuration at each breakpoint */
  columns?: {
    sm?: BentoColumns
    md?: BentoColumns
    lg?: BentoColumns
    xl?: BentoColumns
  }
  /** Gap between cards in rem */
  gap?: number
  /** Maximum width of the grid */
  maxWidth?: string
}

export function BentoGrid({
  children,
  className = '',
  columns = { sm: 2, md: 3, lg: 4, xl: 6 },
  gap = 1,
  maxWidth = '1400px'
}: BentoGridProps) {
  const gridStyle: React.CSSProperties = {
    '--bento-gap': `${gap}rem`,
    '--bento-max-width': maxWidth,
    '--bento-cols-sm': columns.sm ?? 2,
    '--bento-cols-md': columns.md ?? 3,
    '--bento-cols-lg': columns.lg ?? 4,
    '--bento-cols-xl': columns.xl ?? 6
  } as React.CSSProperties

  return (
    <div className={`bento-grid ${className}`} style={gridStyle}>
      {children}
    </div>
  )
}
