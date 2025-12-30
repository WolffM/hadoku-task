/**
 * MetallicSurface Component
 * Creates a sleek metallic gradient effect with optional noise texture and highlight
 * Uses OKLCH colors from the theme system for consistent theming
 */

import React from 'react'

export interface MetallicSurfaceProps {
  children: React.ReactNode
  className?: string
  /** Include noise texture overlay for brushed metal effect */
  withNoise?: boolean
  /** Include highlight effect simulating light reflection */
  withHighlight?: boolean
  /** Border radius - defaults to theme's card radius */
  radius?: string
  /** Render as a different element */
  as?: 'div' | 'section' | 'article'
}

export function MetallicSurface({
  children,
  className = '',
  withNoise = true,
  withHighlight = true,
  radius,
  as: Component = 'div'
}: MetallicSurfaceProps) {
  const style: React.CSSProperties = radius
    ? ({ '--metallic-radius': radius } as React.CSSProperties)
    : {}

  return (
    <Component
      className={`metallic-surface ${withNoise ? 'metallic-surface--noise' : ''} ${withHighlight ? 'metallic-surface--highlight' : ''} ${className}`}
      style={style}
    >
      {children}
    </Component>
  )
}
