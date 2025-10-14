/**
 * Utility functions for the Task API
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
export function now(): string {
  return new Date().toISOString()
}
