/**
 * Type definitions for @wolffm/task frontend exports
 */

// Import and re-export ThemeName from types.ts (single source of truth)
import type { ThemeName } from './types'
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
}

// Mount function to render the task app
export function mount(el: HTMLElement, props?: TaskAppProps): void

// Unmount function to clean up the task app
export function unmount(el: HTMLElement): void
