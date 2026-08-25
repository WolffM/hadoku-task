/**
 * Type definitions for @wolffm/task frontend exports
 */

// Import and re-export ThemeName from types.ts (single source of truth)
import type { ThemeName } from './types'
import type { PlatformSeed } from '@wolffm/themes'
export type { ThemeName }

// Props interface for configuration from parent app
export interface TaskAppProps {
  basename?: string
  /**
   * Caller tier, as the host resolved it. `service` and `wife` were both
   * missing from this union — drift, not a narrower contract: edge-router
   * stamps either one and the host passes it straight through, so the app was
   * type-lying about values it already received at runtime.
   */
  userType?: 'public' | 'friend' | 'service' | 'wife' | 'admin'
  sessionId?: string
  displayName?: string
  theme?: ThemeName | string
  onKeyValidation?: (isValid: boolean, userType?: string, displayName?: string) => void
  /**
   * Device context resolved once by the host at mount. A SEED for first paint,
   * not the live value — read it through `usePlatform({ propsPlatform })`,
   * which owns every update after mount so a rotation is never lost. Absent
   * when there is no host (the Capacitor shell, the standalone dev server),
   * and that is fine: usePlatform detects for itself.
   *
   * Not to be confused with `isMobileApp()` in utils/platform.ts, which asks
   * whether we are inside the native shell — a question the host genuinely
   * cannot answer, and which stays local.
   */
  platform?: PlatformSeed
}

// Mount function to render the task app
export function mount(el: HTMLElement, props?: TaskAppProps): void

// Unmount function to clean up the task app
export function unmount(el: HTMLElement): void
