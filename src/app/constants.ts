/**
 * Application-wide constants
 * Centralized configuration values used across the app
 */

// UI Configuration
export const MAX_BOARDS = 5 // Maximum number of boards to display in the board list

// Drag and Drop
export const MARQUEE_CLICK_GRACE_PERIOD = 300 // ms to wait before clearing selection after marquee ends

// Storage Versioning
export const STORAGE_VERSION = '1.0'
export const STORAGE_VERSION_KEY = 'task-storage-version'

// Orphaned key patterns (for cleanup during migration)
export const ORPHANED_KEY_PATTERNS = [
  /^tasks-/, // tasks-main, tasks-work
  /^stats-/, // stats-main, stats-work
  /^boards$/, // boards (without prefix)
  /^preferences$/ // preferences (without prefix)
]
