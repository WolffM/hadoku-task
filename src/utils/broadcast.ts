/**
 * Shared broadcast utilities for cross-tab communication
 * Provides deferred broadcasting to ensure localStorage propagation
 */

import { logger } from '@wolffm/task-ui-components'
import { formatError } from '../domain/utils/tags'

export type BroadcastType = 'tasks-updated' | 'boards-updated'

export interface BroadcastData {
  type: BroadcastType
  sessionId?: string
  userType?: string
  boardId?: string
  [key: string]: unknown
}

/**
 * Broadcast a message with a delay to ensure localStorage propagation across tabs
 *
 * @param type - Type of broadcast event
 * @param data - Additional data to broadcast
 * @param delayMs - Delay before broadcasting (default: 50ms)
 */
export function deferredBroadcast(
  type: BroadcastType,
  data: Omit<BroadcastData, 'type'> = {},
  delayMs: number = 50
): void {
  setTimeout(() => {
    try {
      const bc = new BroadcastChannel('tasks')
      bc.postMessage({ type, ...data })
      bc.close()
    } catch (err) {
      logger.error('[broadcast] Failed to broadcast', {
        error: formatError(err)
      })
    }
  }, delayMs)
}
