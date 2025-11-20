/**
 * Type definitions for @wolffm/task frontend exports
 */

// Theme names
export type ThemeName =
  | 'light'
  | 'dark'
  | 'coffee-light'
  | 'coffee-dark'
  | 'nature-light'
  | 'nature-dark'
  | 'lavender-light'
  | 'lavender-dark'
  | 'strawberry-light'
  | 'strawberry-dark'
  | 'ocean-light'
  | 'ocean-dark'
  | 'cyberpunk-light'
  | 'cyberpunk-dark'
  | 'pink-light'
  | 'pink-dark'
  | 'izakaya-light'
  | 'izakaya-dark'

// Props interface for configuration from parent app
export interface TaskAppProps {
  basename?: string
  userType?: 'public' | 'friend' | 'admin'
  sessionId?: string
  displayName?: string
  theme?: ThemeName | string
  onKeyValidation?: (isValid: boolean, userType?: string, displayName?: string) => void
}

// Mount function to render the task app
export function mount(el: HTMLElement, props?: TaskAppProps): void

// Unmount function to clean up the task app
export function unmount(el: HTMLElement): void
