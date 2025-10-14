/**
 * Helper utilities for useTasks hook
 * Extracts common patterns to reduce duplication
 */

import { SESSION_ID } from '../../api/session'

/**
 * Broadcast a tasks-updated message with a delay to ensure localStorage propagation
 */
export function deferredBroadcast(
  sessionId: string,
  userType: string,
  userId?: string,
  delayMs: number = 50
) {
  setTimeout(() => {
    try {
      const bc = new BroadcastChannel('tasks')
      bc.postMessage({ type: 'tasks-updated', sessionId, userType, userId })
      bc.close()
    } catch (err) {
      console.error('[useTasks] Broadcast failed:', err)
    }
  }, delayMs)
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
    console.log(`[withPendingOperation] Operation already pending: ${operationKey}`)
    return undefined
  }

  // Add to pending operations
  setPendingOps((prev) => new Set([...prev, operationKey]))

  try {
    const result = await operation()
    return result
  } catch (error) {
    // Suppress 404 errors (task/resource already processed)
    const is404 = suppress404 && (error as any)?.message?.includes('404')
    if (!is404) {
      if (onError) {
        onError(error as Error)
      } else {
        console.error(`[withPendingOperation] Error in ${operationKey}:`, error)
      }
    }
    return undefined
  } finally {
    // Remove from pending operations
    setPendingOps((prev) => {
      const newSet = new Set(prev)
      newSet.delete(operationKey)
      return newSet
    })
  }
}

/**
 * Wrapper for bulk operations that suppresses individual broadcasts
 * and triggers a single broadcast after completion
 */
export async function withBulkOperation(
  operation: () => Promise<void>,
  userType: string,
  userId?: string
): Promise<void> {
  await operation()
  
  // Manually broadcast after bulk operation completes
  console.log('[withBulkOperation] Broadcasting bulk update with delay')
  deferredBroadcast(SESSION_ID, userType, userId)
}

/**
 * Helper to switch board and load its tasks
 */
export interface BoardSwitchResult {
  tasks: any[] // Task array from the board
  foundBoard: boolean
}

export function extractBoardTasks(
  boards: any, // BoardsFile
  boardId: string
): BoardSwitchResult {
  const board = boards?.boards?.find((b: any) => b.id === boardId)
  
  if (board) {
    console.log(`[extractBoardTasks] Found board ${boardId}`, {
      taskCount: board.tasks?.length || 0,
    })
    return {
      tasks: (board.tasks || []).filter((t: any) => t.state === 'Active'),
      foundBoard: true,
    }
  } else {
    console.log(`[extractBoardTasks] Board not found: ${boardId}`)
    return {
      tasks: [],
      foundBoard: false,
    }
  }
}
