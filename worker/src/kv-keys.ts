/**
 * KV Key Generators
 *
 * Centralized location for all KV key generation functions.
 * Ensures consistent key format across the application.
 */

import { DEFAULT_SESSION_ID, KV_PREFIXES } from './constants'

// ============================================================================
// Board & Task Storage Keys
// ============================================================================

/**
 * Generate KV key for boards storage
 * Format: boards:{sessionId}
 */
export function boardsKey(sessionId?: string): string {
  return `${KV_PREFIXES.BOARDS}:${sessionId ?? DEFAULT_SESSION_ID}`
}

/**
 * Generate KV key for tasks storage
 * Format: tasks:{sessionId}:{boardId}
 */
export function tasksKey(sessionId: string | undefined, boardId: string): string {
  return `${KV_PREFIXES.TASKS}:${sessionId ?? DEFAULT_SESSION_ID}:${boardId}`
}

// ============================================================================
// Preferences Keys
// ============================================================================

/**
 * Generate KV key for preferences by sessionId
 * Format: prefs:{sessionId}
 */
export function preferencesKey(sessionId: string): string {
  return `${KV_PREFIXES.PREFS}:${sessionId}`
}

// ============================================================================
// Session Management Keys
// ============================================================================

/**
 * Generate KV key for session info by sessionId
 * Format: session-info:{sessionId}
 */
export function sessionInfoKey(sessionId: string): string {
  return `${KV_PREFIXES.SESSION_INFO}:${sessionId}`
}

/**
 * Generate KV key for session mapping by authKey
 * Format: session-map:{authKey}
 */
export function sessionMappingKey(authKey: string): string {
  return `${KV_PREFIXES.SESSION_MAP}:${authKey}`
}

// ============================================================================
// Throttle & Rate Limiting Keys
// ============================================================================

/**
 * Generate KV key for throttle state
 * Format: throttle:{sessionId}
 */
export function throttleKey(sessionId: string): string {
  return `throttle:${sessionId}`
}

/**
 * Generate KV key for incidents tracking
 * Format: incidents:{sessionId}
 */
export function incidentsKey(sessionId: string): string {
  return `incidents:${sessionId}`
}

/**
 * Generate KV key for blacklist tracking
 * Format: blacklist:{sessionId}
 */
export function blacklistKey(sessionId: string): string {
  return `blacklist:${sessionId}`
}
