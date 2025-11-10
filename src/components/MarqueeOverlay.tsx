/**
 * Marquee selection overlay component
 */

import React from 'react'

interface MarqueeOverlayProps {
  rect: { x: number; y: number; w: number; h: number } | null
  isSelecting: boolean
}

export function MarqueeOverlay({ rect, isSelecting }: MarqueeOverlayProps) {
  if (!isSelecting || !rect) return null

  // Dynamic positioning requires inline styles
  return (
    <div
      className="marquee-overlay"
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.w}px`,
        height: `${rect.h}px`
      }}
    />
  )
}
