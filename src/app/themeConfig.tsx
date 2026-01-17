/**
 * Theme configuration
 * Defines all available theme families and their icons
 */

import React from 'react'
import {
  SunIcon,
  MoonIcon,
  StrawberryIcon,
  WaveIcon,
  ZapIcon,
  CoffeeIcon,
  FlowerIcon,
  LeafIcon,
  HeartIcon,
  SpaIcon
} from '@wolffm/task-ui-components'
import type { ThemeName } from './types'

// Define a properly typed ThemeFamily for this app
export interface ThemeFamily {
  lightIcon: React.ReactNode
  darkIcon: React.ReactNode
  lightTheme: ThemeName
  darkTheme: ThemeName
  lightLabel: string
  darkLabel: string
}

// Base theme families (always available)
export const BASE_THEME_FAMILIES: ThemeFamily[] = [
  {
    lightIcon: <SunIcon />,
    darkIcon: <MoonIcon />,
    lightTheme: 'light',
    darkTheme: 'dark',
    lightLabel: 'Light',
    darkLabel: 'Dark'
  },
  {
    lightIcon: <CoffeeIcon />,
    darkIcon: <CoffeeIcon />,
    lightTheme: 'coffee-light',
    darkTheme: 'coffee-dark',
    lightLabel: 'Coffee Light',
    darkLabel: 'Coffee Dark'
  },
  {
    lightIcon: <LeafIcon />,
    darkIcon: <LeafIcon />,
    lightTheme: 'nature-light',
    darkTheme: 'nature-dark',
    lightLabel: 'Nature Light',
    darkLabel: 'Nature Dark'
  },
  {
    lightIcon: <FlowerIcon />,
    darkIcon: <FlowerIcon />,
    lightTheme: 'lavender-light',
    darkTheme: 'lavender-dark',
    lightLabel: 'Lavender Light',
    darkLabel: 'Lavender Dark'
  },
  {
    lightIcon: <StrawberryIcon />,
    darkIcon: <StrawberryIcon />,
    lightTheme: 'strawberry-light',
    darkTheme: 'strawberry-dark',
    lightLabel: 'Strawberry Light',
    darkLabel: 'Strawberry Dark'
  },
  {
    lightIcon: <WaveIcon />,
    darkIcon: <WaveIcon />,
    lightTheme: 'ocean-light',
    darkTheme: 'ocean-dark',
    lightLabel: 'Ocean Light',
    darkLabel: 'Ocean Dark'
  }
]

// Experimental theme families (gated by preference)
export const EXPERIMENTAL_THEME_FAMILIES: ThemeFamily[] = [
  {
    lightIcon: <ZapIcon />,
    darkIcon: <ZapIcon />,
    lightTheme: 'cyberpunk-light',
    darkTheme: 'cyberpunk-dark',
    lightLabel: 'Cyberpunk Light',
    darkLabel: 'Cyberpunk Dark'
  },
  {
    lightIcon: <HeartIcon />,
    darkIcon: <HeartIcon />,
    lightTheme: 'pink-light',
    darkTheme: 'pink-dark',
    lightLabel: 'Pink Light',
    darkLabel: 'Pink Dark'
  },
  {
    lightIcon: <SpaIcon />,
    darkIcon: <SpaIcon />,
    lightTheme: 'izakaya-light',
    darkTheme: 'izakaya-dark',
    lightLabel: 'Izakaya Light',
    darkLabel: 'Izakaya Dark'
  }
]

/**
 * Get all theme families based on experimental preference
 */
export function getThemeFamilies(experimentalEnabled: boolean): ThemeFamily[] {
  return experimentalEnabled
    ? [...BASE_THEME_FAMILIES, ...EXPERIMENTAL_THEME_FAMILIES]
    : BASE_THEME_FAMILIES
}

/**
 * Check if a theme is experimental
 */
export function isExperimentalTheme(themeName: string): boolean {
  return EXPERIMENTAL_THEME_FAMILIES.some(
    f => f.lightTheme === themeName || f.darkTheme === themeName
  )
}

/**
 * Get icon for a specific theme
 */
export function getThemeIcon(themeName: ThemeName, experimentalEnabled: boolean): React.ReactNode {
  const allFamilies = getThemeFamilies(experimentalEnabled)

  const family = allFamilies.find(f => f.lightTheme === themeName || f.darkTheme === themeName)

  if (!family) return <MoonIcon />

  // Return appropriate icon based on light/dark variant
  return themeName.endsWith('-dark') || themeName === 'dark' ? family.darkIcon : family.lightIcon
}
