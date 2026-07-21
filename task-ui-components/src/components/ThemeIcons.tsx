/**
 * Theme icons - Simple monochrome SVG icons for theme picker
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

export const SunIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
)

export const MoonIcon = () => (
  <svg {...iconProps}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

export const StrawberryIcon = () => (
  <svg {...iconProps}>
    {/* Heart-shaped body with sharp bottom tip */}
    <path
      d="M12 21 C12 21 6.5 15 6.5 11 C6.5 8.5 8 7 10 7 C11 7 12 7.5 12 7.5 C12 7.5 13 7 14 7 C16 7 17.5 8.5 17.5 11 C17.5 15 12 21 12 21 Z"
      fill="currentColor"
    />
    {/* Leaves on top */}
    <path d="M9.5 7.5 L9 5 L11 5.5 Z" fill="currentColor" />
    <path d="M14.5 7.5 L15 5 L13 5.5 Z" fill="currentColor" />
    <path d="M12 7.5 L12 4 L12 5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    {/* Seed slits */}
    <line x1="10" y1="10" x2="10" y2="11" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    <line x1="14" y1="10" x2="14" y2="11" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    <line x1="9" y1="13" x2="9" y2="14" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    <line x1="15" y1="13" x2="15" y2="14" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    <line x1="11" y1="16" x2="11" y2="17" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    <line x1="13" y1="16" x2="13" y2="17" stroke="currentColor" strokeWidth="1" opacity="0.4" />
  </svg>
)

export const WaveIcon = () => (
  <svg {...iconProps}>
    <path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
    <path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
    <path d="M2 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
  </svg>
)

export const ZapIcon = () => (
  <svg {...iconProps}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
)

export const CoffeeIcon = () => (
  <svg {...iconProps}>
    <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
    <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
    <line x1="6" y1="1" x2="6" y2="4" />
    <line x1="10" y1="1" x2="10" y2="4" />
    <line x1="14" y1="1" x2="14" y2="4" />
  </svg>
)

export const FlowerIcon = () => (
  <svg {...iconProps}>
    {/* Center circle - filled */}
    <circle cx="12" cy="12" r="2" fill="currentColor" />
    {/* 5 simple petal curves - outline only */}
    <circle cx="12" cy="6" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx="18" cy="10" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx="16" cy="16" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx="8" cy="16" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx="6" cy="10" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
)

export const HeartIcon = () => (
  <svg {...iconProps}>
    {/* Heart shape */}
    <path
      d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
      fill="currentColor"
    />
  </svg>
)

export const LeafIcon = () => (
  <svg {...iconProps}>
    {/* Leaf shape with vein */}
    <path
      d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"
      fill="currentColor"
    />
    <path
      d="M2 21c0-3 1.85-5.36 5.08-6C9 14.5 11 14 11 20"
      stroke="currentColor"
      strokeWidth="2"
      fill="none"
    />
    {/* Leaf vein */}
    <path d="M11 8c3 2 5 4 7 7" stroke="white" strokeWidth="1.5" opacity="0.4" />
  </svg>
)

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

export const SpaIcon = () => (
  <svg {...iconProps}>
    {/* Steam wisps */}
    <path
      d="M8 2c0 1.5-1 2.5-1 4s1 2.5 1 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      opacity="0.6"
    />
    <path
      d="M12 2c0 1.5-1 2.5-1 4s1 2.5 1 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      opacity="0.6"
    />
    <path
      d="M16 2c0 1.5-1 2.5-1 4s1 2.5 1 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      opacity="0.6"
    />
    {/* Hot spring bowl */}
    <path
      d="M4 14c0-3 1.5-4 4-4s4 1 4 4v4c0 2-1 2-4 2s-4 0-4-2v-4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
    <ellipse cx="8" cy="14" rx="4" ry="1.5" fill="currentColor" opacity="0.3" />
    {/* Stones */}
    <circle cx="17" cy="18" r="2" fill="currentColor" opacity="0.4" />
    <circle cx="20" cy="16" r="1.5" fill="currentColor" opacity="0.4" />
  </svg>
)

/**
 * Generic/Fallback icons for custom themes without specific icons
 * These provide visual differentiation when using the ThemePicker with custom themes
 */

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
