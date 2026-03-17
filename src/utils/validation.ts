/**
 * Validation utilities
 * Common validation functions for user input
 */

import type { Board } from '../domain/types'

/**
 * Validate board name for duplicates and empty strings
 * @returns null if valid, error message string if invalid
 */
export function validateBoardName(name: string, existingBoards: Board[]): string | null {
  const trimmed = name.trim()

  if (!trimmed) {
    return 'Board name cannot be empty'
  }

  const existingNames = existingBoards.map(b => b.id.toLowerCase())
  if (existingNames.includes(trimmed.toLowerCase())) {
    return `Board "${trimmed}" already exists`
  }

  return null // Valid
}
