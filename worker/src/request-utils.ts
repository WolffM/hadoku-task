/**
 * Request Utilities for Task API
 *
 * Common utilities for extracting and validating request parameters.
 *
 * NOTE: Many generic utilities have been moved to @wolffm/worker-utils.
 * This file now contains only task-api-specific helpers.
 */
import { isNonEmptyString } from '@wolffm/worker-utils'

/**
 * Validate board ID (uses util's isNonEmptyString)
 *
 * @param id - Board ID to validate
 * @returns Error message or null if valid
 */
export function validateBoardId(id: string | null): string | null {
  if (!isNonEmptyString(id)) {
    return 'Missing required parameter: board ID'
  }
  return null
}
