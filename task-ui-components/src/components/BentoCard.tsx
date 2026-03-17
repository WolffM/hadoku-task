/**
 * BentoCard Component
 * Base card component for bento grid layouts
 * Supports various sizes and disabled state for preloading
 */

import React from 'react'

export type CardSize = 'default' | 'wide' | 'tall' | 'large' | 'hero'

export interface BentoCardProps {
  children: React.ReactNode
  className?: string
  /** Card size affects grid span */
  size?: CardSize
  /** Disable interactions (for preload state) */
  disabled?: boolean
  /** Click handler */
  onClick?: () => void
  /** Custom aria-label for accessibility */
  ariaLabel?: string
  /** Optional data attributes for animation libraries */
  'data-layout-id'?: string
}

const sizeClasses: Record<CardSize, string> = {
  default: 'bento-card--default',
  wide: 'bento-card--wide',
  tall: 'bento-card--tall',
  large: 'bento-card--large',
  hero: 'bento-card--hero'
}

export function BentoCard({
  children,
  className = '',
  size = 'default',
  disabled = false,
  onClick,
  ariaLabel,
  'data-layout-id': layoutId,
  ...rest
}: BentoCardProps) {
  const handleClick = () => {
    if (!disabled && onClick) {
      onClick()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && !disabled && onClick) {
      e.preventDefault()
      onClick()
    }
  }

  return (
    <article
      className={`bento-card ${sizeClasses[size]} ${disabled ? 'bento-card--disabled' : ''} ${className}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      data-layout-id={layoutId}
      {...rest}
    >
      {children}
    </article>
  )
}
