/**
 * @wolffm/task-ui-components
 * Reusable UI components for task management applications
 * Production-ready and fully typed
 *
 * 2.2.0 — AppHeader + ConnectedSettings (with a `children` extension slot).
 */

// Main components
//
// NOTE: `ThemePicker` and `ConnectedThemePicker` are intentionally NOT exported.
// AppHeader renders the theme picker itself from the HadokuThemeRoot context,
// so every app gets the same control by construction. Exporting them is what
// let an app hand-roll its own (with its own open-state and a debug logger in
// the icon resolver) — a compile error is the only enforcement that actually
// holds. If you need theme state, use `useTheme()` from @wolffm/themes.
// The picker itself, for an app with no header row to put it in (watchpart2's
// UI is a video overlay). It takes NO props — placement is free, configuration
// is not, which is the property that keeps it identical everywhere.
export { HadokuThemePicker } from './components/HadokuThemePicker'
export { AppHeader } from './components/AppHeader'
export { ConnectedSettings } from './components/ConnectedSettings'
// Re-exported from @wolffm/themes, which now owns the context AND the provider
// that fills it. These are RE-EXPORTS, not re-declarations: every consumer gets
// the one context object from themes, which is what makes a duplicated copy of
// THIS package harmless. Kept here so existing
// `import { useHadokuTheme } from '@wolffm/task-ui-components'` call sites
// across the fleet keep working unchanged.
export { HadokuThemeProvider, useHadokuTheme, useHadokuThemeOptional } from '@wolffm/themes'
export type { HadokuThemeValue, HadokuThemeProviderProps } from '@wolffm/themes'
export { Toast } from './components/Toast'
export { Toaster } from './components/Toaster'
export { Modal } from './components/Modal'
export { ContextMenu } from './components/ContextMenu'
export { LoadingSkeleton } from './components/LoadingSkeleton'
export { SettingsModal } from './components/SettingsModal'

// Bento components
export { BentoGrid } from './components/BentoGrid'
export { BentoCard } from './components/BentoCard'

// Hooks
export { useToast } from './hooks/useToast'
export { useReducedMotion } from './hooks/useReducedMotion'

// Theme icons - export individually for flexibility
export {
  SettingsIcon,
  TagIcon,
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
// Theme-family icons moved to @wolffm/themes with the rest of the theme model.
// Re-exported so existing imports from this package keep resolving.
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
  SpaIcon
} from '@wolffm/themes'

// Types
// ThemeFamily stays — @wolffm/themes builds THEME_FAMILIES against it.
// ThemePickerProps / ConnectedThemePickerProps are gone with the components:
// a prop type you cannot render is only useful for reimplementing the control.
export type { ThemeName, ThemeFamily, DropdownPlacement, ThemeMode } from './types'
export type { AppHeaderProps } from './components/AppHeader'
export type { ConnectedSettingsProps } from './components/ConnectedSettings'
export type { ContentLevelState, Identity, KeySwapResult, Tier } from './lib/settingsClient'
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
export type { BentoGridProps, BentoColumns } from './components/BentoGrid'
export type { BentoCardProps, CardSize } from './components/BentoCard'

// `logger` was removed in v2.0.0. Migrate to `@wolffm/logger/client`:
//   - import { logger } from '@wolffm/task-ui-components'
//   + import { logger } from '@wolffm/logger/client'
// See packages/logger in hadoku_site for the consolidated cross-runtime
// implementation. UI helpers (theme, component, preference, apiRequest,
// apiResponse, fallback) are preserved on the new client logger.
