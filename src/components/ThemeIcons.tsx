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
  strokeLinejoin: 'round' as const,
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
    {/* Heart-shaped body with sharp bottom tip - slightly fatter */}
    <path d="M12 21 C12 21 6.5 15 6.5 11 C6.5 8.5 8 7 10 7 C11 7 12 7.5 12 7.5 C12 7.5 13 7 14 7 C16 7 17.5 8.5 17.5 11 C17.5 15 12 21 12 21 Z" fill="currentColor" />
    {/* More visible leaves on top */}
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
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="currentColor" />
  </svg>
)

export const SettingsIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v6m0 6v6M4.2 4.2l4.2 4.2m5.6 5.6l4.2 4.2M1 12h6m6 0h6M4.2 19.8l4.2-4.2m5.6-5.6l4.2-4.2" />
  </svg>
)
