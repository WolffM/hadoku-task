/**
 * @wolffm/task-ui-components
 * Reusable UI components for task management applications
 */

// Main components
export { ThemePicker } from './components/ThemePicker'

// Theme icons - export individually for flexibility
export {
  SunIcon,
  MoonIcon,
  StrawberryIcon,
  WaveIcon,
  ZapIcon,
  CoffeeIcon,
  FlowerIcon,
  HeartIcon,
  LeafIcon,
  SettingsIcon,
  TagIcon,
  SpaIcon,
  // Generic/Fallback icons
  CircleIcon,
  SquareIcon,
  TriangleIcon,
  DiamondIcon,
  StarIcon,
  HexagonIcon,
  PentagonIcon,
  OctagonIcon,
  FALLBACK_ICONS,
  getFallbackIcon
} from './components/ThemeIcons'

// Types
export type {
  ThemeName,
  ThemeFamily,
  ThemePickerProps
} from './types'

// Utilities
export { logger } from './utils/logger'
