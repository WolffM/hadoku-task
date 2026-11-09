/**
 * Application-wide constants
 * Centralized configuration values used across the app
 */

// UI Configuration. The top-bar budget lives with the pin rules that use it,
// because the board handlers (shared with the server) need it too.
export { TOPBAR_BOARD_SLOTS } from '../domain/utils/boardPins'

// Drag and Drop
export const MARQUEE_CLICK_GRACE_PERIOD = 300 // ms to wait before clearing selection after marquee ends
