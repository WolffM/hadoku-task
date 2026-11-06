/** Board lifecycle: create, delete, rename, and the pinned top-bar order. */
import { logger } from '@wolffm/logger/client'
import { adminHeaders, backgroundSync, type ApiCtx } from './client-context'
import { MAX_BATCH_DELETE_BOARDS } from '../domain/types'

export function boardMethods(ctx: ApiCtx) {
  const { localStorage, onSyncError, sessionId } = ctx
  return {
    // Board operations
    async createBoard(boardId: string) {
      logger.info('[api] createBoard: Starting', { boardId })
      const result = await localStorage.createBoard(boardId)
      logger.info('[api] createBoard: Created locally', { boardId })

      backgroundSync(
        '/task/api/boards',
        {
          method: 'POST',
          headers: adminHeaders(sessionId),
          body: JSON.stringify({ id: boardId, name: boardId })
        },
        'createBoard',
        { boardId },
        onSyncError
      )
      return result
    },

    async deleteBoard(boardId: string) {
      logger.info('[api] deleteBoard: Starting', { boardId })
      const result = await localStorage.deleteBoard(boardId)
      logger.info('[api] deleteBoard: Deleted locally', { boardId })

      backgroundSync(
        `/task/api/boards/${encodeURIComponent(boardId)}`,
        {
          method: 'DELETE',
          headers: adminHeaders(sessionId)
        },
        'deleteBoard',
        { boardId },
        onSyncError
      )
      return result
    },

    /**
     * Delete several boards: one local write and one background sync, not one
     * of each per board (#86). Only the boards the local write actually removed
     * are sent; a selection over MAX_BATCH_DELETE_BOARDS goes as several requests.
     */
    async deleteBoards(boardIds: string[]) {
      logger.info('[api] deleteBoards: Starting', { count: boardIds.length })
      const result = await localStorage.deleteBoards(boardIds)
      logger.info('[api] deleteBoards: Deleted locally', {
        deleted: result.deleted.length,
        notFound: result.notFound.length
      })

      for (let i = 0; i < result.deleted.length; i += MAX_BATCH_DELETE_BOARDS) {
        const chunk = result.deleted.slice(i, i + MAX_BATCH_DELETE_BOARDS)
        backgroundSync(
          '/task/api/batch/delete-boards',
          {
            method: 'POST',
            headers: adminHeaders(sessionId),
            body: JSON.stringify({ boardIds: chunk })
          },
          'deleteBoards',
          { count: chunk.length },
          onSyncError
        )
      }
      return result
    },

    async renameBoard(boardId: string, name: string) {
      const result = await localStorage.renameBoard(boardId, name)
      backgroundSync(
        `/task/api/boards/${encodeURIComponent(boardId)}`,
        {
          method: 'PATCH',
          headers: adminHeaders(sessionId),
          body: JSON.stringify({ name })
        },
        'renameBoard',
        { boardId },
        onSyncError
      )
      return result
    },

    async setPinnedBoards(order: string[]) {
      const result = await localStorage.setPinnedBoards(order)
      backgroundSync(
        '/task/api/boards/pinned',
        {
          method: 'PUT',
          headers: adminHeaders(sessionId),
          body: JSON.stringify({ order })
        },
        'setPinnedBoards',
        { count: order.length },
        onSyncError
      )
      return result
    }
  }
}
