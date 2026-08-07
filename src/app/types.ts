/**
 * Client-only type definitions
 *
 * Domain types are imported from '../domain/types' directly by their
 * consumers; this module holds only client-specific types.
 */

// Client-only types
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

/**
 * Which view the task app is showing. The Board/Calendar switch is a toggle
 * button in the tag-filters toolbar (`TagFiltersSection`) — there is no longer
 * a separate switcher row.
 */
export type ViewType = 'board' | 'calendar'
