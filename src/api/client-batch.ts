/**
 * Batch writes — one request per human gesture, not one per card.
 *
 * These call the LEGACY route aliases (`/task/api/batch-tag`,
 * `/task/api/batch-move`) rather than the newer nested paths. Both are live on
 * the worker; which one ships is pinned by src/test/api-client-verify.ts.
 */
import { logger } from '@wolffm/logger/client'
import { formatError } from '../domain/utils/tags'
import { adminHeaders, backgroundSync, type ApiCtx } from './client-context'

export function batchMethods(ctx: ApiCtx) {
  const { localStorage, onSyncError, userType, sessionId } = ctx
  return {
    // Batch operations
    async batchUpdateTags(boardId: string, updates: Array<{ taskId: string; tag: string | null }>) {
      logger.info('[api] batchUpdateTags: Starting', {
        boardId,
        count: updates.length
      })

      // This is the write path a LANE DRAG takes, and on an automation board the
      // server can refuse it outright — an `agent` lane is not the human's to
      // write. Capture where each task was BEFORE the optimistic move so a refusal
      // can put it back; otherwise the card sits in the lane it never reached and
      // only snaps back at the next full sync, which reads as data loss.
      const before = await (async () => {
        try {
          const bf = await localStorage.getBoards()
          const board = bf.boards.find(b => b.id === boardId)
          const byId = new Map((board?.tasks ?? []).map(t => [t.id, t.tag ?? null]))
          return updates
            .filter(u => byId.has(u.taskId))
            .map(u => ({ taskId: u.taskId, tag: byId.get(u.taskId) ?? null }))
        } catch (err) {
          // No snapshot means no revert, which is strictly better than no move.
          logger.warn('[api] batchUpdateTags: could not snapshot prior tags', {
            boardId,
            error: formatError(err)
          })
          return null
        }
      })()

      // 1. OPTIMISTIC: Update tags in localStorage
      await localStorage.batchUpdateTags(boardId, updates)
      logger.info('[api] batchUpdateTags: Updated locally', { boardId, count: updates.length })

      // 2. BACKGROUND: Sync to server (fire-and-forget)
      backgroundSync(
        '/task/api/batch-tag',
        {
          method: 'PATCH',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ boardId, updates })
        },
        'batchUpdateTags',
        { boardId, count: updates.length },
        onSyncError,
        async () => {
          if (!before || before.length === 0) return false
          // Re-applying through the same local write broadcasts `tasks-updated`,
          // which is what repaints the board — so the card visibly returns to
          // where it was rather than waiting for a reload.
          await localStorage.batchUpdateTags(boardId, before)
          logger.info('[api] batchUpdateTags: reverted the optimistic move', {
            boardId,
            count: before.length
          })
          return true
        }
      )
    },

    async batchMoveTasks(sourceBoardId: string, targetBoardId: string, taskIds: string[]) {
      logger.info('[api] batchMoveTasks: Starting', {
        sourceBoardId,
        targetBoardId,
        count: taskIds.length
      })

      // 1. OPTIMISTIC: Move tasks in localStorage
      const result = await localStorage.batchMoveTasks(sourceBoardId, targetBoardId, taskIds)
      logger.info('[api] batchMoveTasks: Moved locally', {
        sourceBoardId,
        targetBoardId,
        count: taskIds.length
      })

      // 2. BACKGROUND: Sync to server (fire-and-forget)
      backgroundSync(
        '/task/api/batch-move',
        {
          method: 'POST',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ sourceBoardId, targetBoardId, taskIds })
        },
        'batchMoveTasks',
        { sourceBoardId, targetBoardId, count: taskIds.length },
        onSyncError
      )

      return result
    },

    async batchClearTag(boardId: string, tag: string, taskIds: string[]) {
      logger.info('[api] batchClearTag: Starting', {
        boardId,
        tag,
        count: taskIds.length
      })

      // 1. OPTIMISTIC: Clear tag in localStorage
      await localStorage.batchClearTag(boardId, tag, taskIds)
      logger.info('[api] batchClearTag: Cleared locally', { boardId, tag, count: taskIds.length })

      // 2. BACKGROUND: Sync to server (fire-and-forget)
      backgroundSync(
        '/task/api/batch-clear-tag',
        {
          method: 'POST',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ boardId, tag, taskIds })
        },
        'batchClearTag',
        { boardId, tag, count: taskIds.length },
        onSyncError
      )
    }
  }
}
