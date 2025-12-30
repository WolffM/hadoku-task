/**
 * ShimmerOverlay Component
 * Subtle animated shimmer effect for loading states
 * Used to indicate content is being preloaded
 */

import React from 'react'

export interface ShimmerOverlayProps {
  /** Whether the shimmer is active */
  active: boolean
  className?: string
}

export function ShimmerOverlay({ active, className = '' }: ShimmerOverlayProps) {
  if (!active) return null

  return <div className={`shimmer-overlay ${className}`} aria-hidden="true" role="presentation" />
}
