/**
 * Helper utilities for useTasks hook
 * Extracts common patterns to reduce duplication
 */

import { logger } from '@wolffm/task-ui-components'
import type { Task, BoardsFile, Board } from '../../domain/types'
import { DomainError } from '../../domain/types'
import { formatError } from '../../domain/utils/tags'

/**
 * Check if an error is a 404 (not found) error
 * Supports both DomainError with httpStatus and legacy string matching
 */
function is404Error(error: unknown): boolean {
  // Check for DomainError with httpStatus
  if (error instanceof DomainError && error.httpStatus === 404) {
    return true
  }
  // Fallback: check error message for '404' (for server responses)
  const errorMessage = formatError(error)
  return errorMessage.includes('404') || errorMessage.includes('not found')
}

/**
 * Generic operation wrapper that handles:
 * - Duplicate request prevention via pending operations
 * - Error handling with 404 suppression
 * - Pending state management
 */
export async function withPendingOperation<T>(
  operationKey: string,
  pendingOps: Set<string>,
  setPendingOps: (updater: (prev: Set<string>) => Set<string>) => void,
  operation: () => Promise<T>,
  options: {
    onError?: (error: Error) => void
    suppress404?: boolean
  } = {}
): Promise<T | undefined> {
  const { onError, suppress404 = true } = options

  // Prevent duplicate requests
  if (pendingOps.has(operationKey)) {
    logger.info('[withPendingOperation] Operation already pending', { operationKey })
    return undefined
  }

  // Add to pending operations
  setPendingOps(prev => new Set([...prev, operationKey]))

  try {
    const result = await operation()
    return result
  } catch (error) {
    // Suppress 404 errors (task/resource already processed on another device)
    const shouldSuppress = suppress404 && is404Error(error)
    if (!shouldSuppress) {
      if (onError) {
        onError(error as Error)
      } else {
        logger.error('[withPendingOperation] Error in operation', {
          operationKey,
          error: formatError(error)
        })
      }
    } else {
      logger.info('[withPendingOperation] Suppressed 404 error (resource already processed)', {
        operationKey
      })
    }
    return undefined
  } finally {
    // Remove from pending operations
    setPendingOps(prev => {
      const newSet = new Set(prev)
      newSet.delete(operationKey)
      return newSet
    })
  }
}

/**
 * Helper to switch board and load its tasks
 */
export interface BoardSwitchResult {
  tasks: Task[]
  foundBoard: boolean
}

export function extractBoardTasks(boards: BoardsFile | null, boardId: string): BoardSwitchResult {
  const board = boards?.boards?.find((b: Board) => b.id === boardId)

  if (board) {
    logger.info('[extractBoardTasks] Found board', {
      boardId,
      taskCount: board.tasks?.length || 0
    })
    return {
      tasks: (board.tasks || []).filter((t: Task) => t.state === 'Active'),
      foundBoard: true
    }
  } else {
    logger.info('[extractBoardTasks] Board not found', { boardId })
    return {
      tasks: [],
      foundBoard: false
    }
  }
}
