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

  // Use CSS custom properties for dynamic positioning
  const style = {
    '--marquee-left': `${rect.x}px`,
    '--marquee-top': `${rect.y}px`,
    '--marquee-width': `${rect.w}px`,
    '--marquee-height': `${rect.h}px`
  } as React.CSSProperties

  return <div className="marquee-overlay" style={style} />
}
