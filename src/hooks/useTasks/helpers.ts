/**
 * Helper utilities for useTasks hook
 * Extracts common patterns to reduce duplication
 */

import { logger } from '@wolffm/task-ui-components'
import type { Task, BoardsFile, Board } from '../../domain/types'
import { formatError } from '../../domain/utils/tags'

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
    // Suppress 404 errors (task/resource already processed)
    const errorMessage = formatError(error)
    const is404 = suppress404 && errorMessage.includes('404')
    if (!is404) {
      if (onError) {
        onError(error as Error)
      } else {
        logger.error('[withPendingOperation] Error in operation', {
          operationKey,
          error: errorMessage
        })
      }
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
