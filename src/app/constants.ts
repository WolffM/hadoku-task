/**
 * Application-wide constants
 * Centralized configuration values used across the app
 */

// UI Configuration
// How many boards the top bar holds. This is a display budget, NOT a cap on how
// many boards a user can have — the server never limited board count. Boards
// beyond the pinned few are reached through the Edit Boards picker.
export const TOPBAR_BOARD_SLOTS = 5

// Drag and Drop
export const MARQUEE_CLICK_GRACE_PERIOD = 300 // ms to wait before clearing selection after marquee ends
