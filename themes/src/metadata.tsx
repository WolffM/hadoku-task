/**
 * Theme metadata - icon mappings and theme family configurations
 * This file imports icons from @wolffm/task-ui-components
 */

import React from 'react'
import type { ThemeFamily } from '@wolffm/task-ui-components'
import {
  SunIcon,
  MoonIcon,
  StrawberryIcon,
  WaveIcon,
  ZapIcon,
  CoffeeIcon,
  FlowerIcon,
  HeartIcon,
  LeafIcon,
  SpaIcon
} from '@wolffm/task-ui-components'

/**
 * Theme families configuration for all 9 theme pairs
 * Each family has a light and dark variant with corresponding icons
 */
export const THEME_FAMILIES: ThemeFamily[] = [
  {
    lightTheme: 'light',
    darkTheme: 'dark',
    lightLabel: 'Light',
    darkLabel: 'Dark',
    lightIcon: <SunIcon />,
    darkIcon: <MoonIcon />
  },
  {
    lightTheme: 'strawberry-light',
    darkTheme: 'strawberry-dark',
    lightLabel: 'Strawberry Light',
    darkLabel: 'Strawberry Dark',
    lightIcon: <StrawberryIcon />,
    darkIcon: <StrawberryIcon />
  },
  {
    lightTheme: 'ocean-light',
    darkTheme: 'ocean-dark',
    lightLabel: 'Ocean Light',
    darkLabel: 'Ocean Dark',
    lightIcon: <WaveIcon />,
    darkIcon: <WaveIcon />
  },
  {
    lightTheme: 'cyberpunk-light',
    darkTheme: 'cyberpunk-dark',
    lightLabel: 'Cyberpunk Light',
    darkLabel: 'Cyberpunk Dark',
    lightIcon: <ZapIcon />,
    darkIcon: <ZapIcon />
  },
  {
    lightTheme: 'coffee-light',
    darkTheme: 'coffee-dark',
    lightLabel: 'Coffee Light',
    darkLabel: 'Coffee Dark',
    lightIcon: <CoffeeIcon />,
    darkIcon: <CoffeeIcon />
  },
  {
    lightTheme: 'lavender-light',
    darkTheme: 'lavender-dark',
    lightLabel: 'Lavender Light',
    darkLabel: 'Lavender Dark',
    lightIcon: <FlowerIcon />,
    darkIcon: <FlowerIcon />
  },
  {
    lightTheme: 'nature-light',
    darkTheme: 'nature-dark',
    lightLabel: 'Nature Light',
    darkLabel: 'Nature Dark',
    lightIcon: <LeafIcon />,
    darkIcon: <LeafIcon />
  },
  {
    lightTheme: 'pink-light',
    darkTheme: 'pink-dark',
    lightLabel: 'Pink Light',
    darkLabel: 'Pink Dark',
    lightIcon: <HeartIcon />,
    darkIcon: <HeartIcon />
  },
  {
    lightTheme: 'izakaya-light',
    darkTheme: 'izakaya-dark',
    lightLabel: 'Izakaya Light',
    darkLabel: 'Izakaya Dark',
    lightIcon: <SpaIcon />,
    darkIcon: <SpaIcon />
  }
]

/**
 * Theme icon mapping - maps each theme name to its icon component
 * Useful for getting the icon for a specific theme
 */
export const THEME_ICON_MAP = {
  light: SunIcon,
  dark: MoonIcon,
  'strawberry-light': StrawberryIcon,
  'strawberry-dark': StrawberryIcon,
  'ocean-light': WaveIcon,
  'ocean-dark': WaveIcon,
  'cyberpunk-light': ZapIcon,
  'cyberpunk-dark': ZapIcon,
  'coffee-light': CoffeeIcon,
  'coffee-dark': CoffeeIcon,
  'lavender-light': FlowerIcon,
  'lavender-dark': FlowerIcon,
  'nature-light': LeafIcon,
  'nature-dark': LeafIcon,
  'pink-light': HeartIcon,
  'pink-dark': HeartIcon,
  'izakaya-light': SpaIcon,
  'izakaya-dark': SpaIcon
} as const
