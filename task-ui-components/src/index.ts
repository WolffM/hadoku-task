/**
 * @wolffm/task-ui-components
 * Reusable UI components for task management applications
 */

// Main components
export { ThemePicker } from './components/ThemePicker'
export { ConnectedThemePicker } from './components/ConnectedThemePicker'
export { Toast } from './components/Toast'
export { Toaster } from './components/Toaster'
export { Modal } from './components/Modal'
export { ContextMenu } from './components/ContextMenu'
export { LoadingSkeleton } from './components/LoadingSkeleton'
export { SettingsModal } from './components/SettingsModal'

// Hooks
export { useToast } from './hooks/useToast'

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
export type { ThemeName, ThemeFamily, ThemePickerProps } from './types'
export type { ToastProps } from './components/Toast'
export type { ToasterProps, ToastState } from './components/Toaster'
export type { UseToastReturn } from './hooks/useToast'
export type { ModalProps } from './components/Modal'
export type { ContextMenuProps, ContextMenuItem } from './components/ContextMenu'
export type { LoadingSkeletonProps } from './components/LoadingSkeleton'
export type {
  SettingsModalProps,
  SettingsSection,
  SettingsField,
  SettingsToggleField,
  SettingsTextInputField,
  SettingsPasswordField,
  SettingsSelectField,
  SettingsButtonField,
  SettingsCustomField
} from './components/SettingsModal'

// Utilities
export { logger } from './utils/logger'
