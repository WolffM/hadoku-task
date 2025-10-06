/**
 * Utility functions for the Task Router
 */

/**
 * Generate a ULID (Universally Unique Lexicographically Sortable Identifier)
 * Format: TTTTTTTTRRRRRRRRRRRRRRRRRR (8 timestamp + 18 random chars)
 */
export function generateULID(): string {
  const timestamp = Date.now().toString(36).toUpperCase().padStart(8, '0')
  const randomBytes = crypto.getRandomValues(new Uint8Array(18))
  const random = Array.from(randomBytes)
    .map(b => (b % 36).toString(36).toUpperCase())
    .join('')
  return timestamp + random
}

/**
 * Get current ISO 8601 timestamp
 */
export function createISO(): string {
  return new Date().toISOString()
}

/**
 * Create empty tasks file structure
 */
export function createEmptyTasksFile() {
  return {
    version: 1,
    tasks: [],
    updatedAt: createISO()
  }
}

/**
 * Create empty stats file structure
 */
export function createEmptyStatsFile() {
  return {
    version: 2,
    counters: {
      created: 0,
      completed: 0,
      edited: 0,
      deleted: 0
    },
    timeline: [],
    tasks: {},
    updatedAt: createISO()
  }
}
