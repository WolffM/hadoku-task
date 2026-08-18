/** Board lifecycle: create, delete, rename, and the pinned top-bar order. */
import { logger } from '@wolffm/logger/client'
import { adminHeaders, backgroundSync, type ApiCtx } from './client-context'

export function boardMethods(ctx: ApiCtx) {
  const { localStorage, onSyncError, userType, sessionId } = ctx
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
          headers: adminHeaders(userType, sessionId),
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
          headers: adminHeaders(userType, sessionId)
        },
        'deleteBoard',
        { boardId },
        onSyncError
      )
      return result
    },

    async renameBoard(boardId: string, name: string) {
      const result = await localStorage.renameBoard(boardId, name)
      backgroundSync(
        `/task/api/boards/${encodeURIComponent(boardId)}`,
        {
          method: 'PATCH',
          headers: adminHeaders(userType, sessionId),
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
          headers: adminHeaders(userType, sessionId),
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
