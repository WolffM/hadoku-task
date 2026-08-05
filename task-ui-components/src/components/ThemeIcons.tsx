/**
 * Component icons - Simple monochrome SVG icons for theme picker
 * All icons use currentColor so they can be styled with CSS
 */

import React from 'react'

const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export const SettingsIcon = () => (
  <svg {...iconProps}>
    {/* Gear teeth as rectangles */}
    <rect x="11" y="1" width="2" height="3" fill="currentColor" />
    <rect x="16.5" y="3.5" width="3" height="2" fill="currentColor" transform="rotate(45 18 4.5)" />
    <rect x="19" y="11" width="3" height="2" fill="currentColor" />
    <rect
      x="16.5"
      y="18.5"
      width="3"
      height="2"
      fill="currentColor"
      transform="rotate(-45 18 19.5)"
    />
    <rect x="11" y="20" width="2" height="3" fill="currentColor" />
    <rect x="4.5" y="18.5" width="3" height="2" fill="currentColor" transform="rotate(45 6 19.5)" />
    <rect x="2" y="11" width="3" height="2" fill="currentColor" />
    <rect x="4.5" y="3.5" width="3" height="2" fill="currentColor" transform="rotate(-45 6 4.5)" />

    {/* Outer ring */}
    <circle cx="12" cy="12" r="7" fill="currentColor" />

    {/* Center hole */}
    <circle cx="12" cy="12" r="4" fill="var(--color-bg-card)" />
  </svg>
)

export const TagIcon = () => (
  <svg {...iconProps} width={16} height={16} viewBox="0 0 20 20">
    {/* Tag body - rectangular shape pointing right */}
    <path d="M2 4 L12 4 L16 10 L12 16 L2 16 Z" fill="currentColor" />
    {/* Hole in tag */}
    <circle cx="6" cy="10" r="1.5" fill="white" />
  </svg>
)

export const CircleIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="8" />
  </svg>
)

export const SquareIcon = () => (
  <svg {...iconProps}>
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
)

export const TriangleIcon = () => (
  <svg {...iconProps}>
    <path d="M12 5 L21 19 L3 19 Z" />
  </svg>
)

export const DiamondIcon = () => (
  <svg {...iconProps}>
    <path d="M12 2 L22 12 L12 22 L2 12 Z" />
  </svg>
)

export const StarIcon = () => (
  <svg {...iconProps}>
    <polygon points="12,2 15,10 23,10 17,15 19,23 12,18 5,23 7,15 1,10 9,10" />
  </svg>
)

export const HexagonIcon = () => (
  <svg {...iconProps}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
  </svg>
)

export const PentagonIcon = () => (
  <svg {...iconProps}>
    <path d="M12 2 L22 9 L18 20 L6 20 L2 9 Z" />
  </svg>
)

export const OctagonIcon = () => (
  <svg {...iconProps}>
    <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86" />
  </svg>
)

/**
 * Fallback icon sets for themes - provides 8 distinct shapes
 * Use these when you don't have specific icons for your themes
 */

export const FALLBACK_ICONS = [
  CircleIcon,
  SquareIcon,
  TriangleIcon,
  DiamondIcon,
  StarIcon,
  HexagonIcon,
  PentagonIcon,
  OctagonIcon
] as const

/**
 * Get a fallback icon for a theme by index
 * Icons repeat after 8 themes to provide consistent differentiation
 */

export function getFallbackIcon(index: number) {
  const Icon = FALLBACK_ICONS[index % FALLBACK_ICONS.length]
  return <Icon />
}
