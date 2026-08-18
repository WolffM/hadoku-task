/**
 * Boards sync, tasks and tags — everything that writes optimistically.
 *
 * These are the methods that touch the local cache first and reconcile with the
 * server afterwards, which is why they are the only group needing `snapshot`:
 * a refusal has to put the previous task back.
 */
import { logger } from '@wolffm/logger/client'
import { formatError } from '../domain/utils/tags'
import type { BoardsFile, CreateTaskInput } from '../domain/types'
import {
  adminHeaders,
  syncBoardsToLocalStorage,
  reportRefusal,
  backgroundSync,
  now,
  type TaskPatch,
  type ApiCtx
} from './client-context'

export function taskMethods(ctx: ApiCtx) {
  const { localStorage, onSyncError, snapshot, userType, sessionId } = ctx
  return {
    // Get boards - returns localStorage immediately (optimistic)
    async getBoards(): Promise<BoardsFile> {
      return await localStorage.getBoards()
    },

    // Sync from API - called once on initial page load to get server state
    //
    // Returns whether server state actually landed in the cache. Callers need
    // that: on failure the UI keeps rendering the previous cache (or nothing at
    // all on a first load), which is indistinguishable from an account that
    // genuinely has no tasks unless someone says otherwise. Failures are still
    // logged here and NOT thrown — a background refresh that can't reach the
    // server is a degraded state to display, not an exception to unwind.
    async syncFromApi(): Promise<boolean> {
      const startTime = now()
      try {
        logger.info('[api] syncFromApi: Starting API sync...', { userType, sessionId })
        const response = await fetch(
          `/task/api/boards?userType=${userType}&sessionId=${encodeURIComponent(sessionId)}`,
          {
            headers: adminHeaders(userType, sessionId),
            cache: 'no-store'
          }
        )

        if (!response.ok) {
          logger.error('[api] syncFromApi: API returned error', {
            status: response.status,
            statusText: response.statusText
          })
          throw new Error(`API returned ${response.status}`)
        }

        const apiData: BoardsFile = await response.json()

        // Validate response structure
        if (!apiData || !apiData.boards || !Array.isArray(apiData.boards)) {
          logger.error('[api] syncFromApi: Invalid response structure', { apiData })
          return false
        }

        const duration = now() - startTime
        logger.info('[api] syncFromApi: Successfully synced from API', {
          boards: apiData.boards.length,
          totalTasks: apiData.boards.reduce((sum, b) => sum + (b.tasks?.length || 0), 0),
          durationMs: Math.round(duration)
        })

        // Update localStorage with server state
        await syncBoardsToLocalStorage(localStorage, apiData, userType, sessionId)
        return true
      } catch (error) {
        const duration = now() - startTime
        logger.error('[api] syncFromApi: Sync from API failed', {
          error: formatError(error),
          durationMs: Math.round(duration)
        })
        return false
      }
    },

    async createTask(
      data: CreateTaskInput,
      boardId: string = 'main',
      suppressBroadcast: boolean = false
    ) {
      logger.info('[api] createTask: Starting', {
        title: data.title,
        boardId,
        hasTag: !!data.tag,
        suppressBroadcast
      })

      // Create task optimistically with client-generated ID (or use provided ID for moves)
      const localTask = await localStorage.createTask(data, boardId, suppressBroadcast)

      logger.info('[api] createTask: Created locally', { taskId: localTask.id, boardId })

      // Send task to server WITH the client-generated ID so server uses same ID
      fetch('/task/api', {
        method: 'POST',
        headers: adminHeaders(userType, sessionId),
        body: JSON.stringify({
          id: data.id || localTask.id, // Use provided ID (for moves) or client-generated ID
          ...data,
          boardId
        })
      })
        .then(async r => {
          if (!r.ok) {
            // Refused create → remove the local task. The inverse is exact here:
            // undoing something that should never have existed leaves nothing
            // behind, unlike restoring a delete.
            await reportRefusal(
              r,
              'createTask',
              { taskId: localTask.id, boardId },
              onSyncError,
              async () => {
                await localStorage.deleteTask(localTask.id, boardId, suppressBroadcast)
                return true
              }
            )
            return
          }
          const serverResponse = (await r.json()) as { ok: boolean; id: string }
          if (serverResponse.ok) {
            if (serverResponse.id === localTask.id) {
              logger.info('[api] createTask: Server sync completed', { taskId: localTask.id })
            } else {
              logger.warn('[api] createTask: Server returned different ID (unexpected)', {
                clientId: localTask.id,
                serverId: serverResponse.id
              })
            }
          }
        })
        .catch(err => {
          logger.error('[api] createTask: Server sync failed', {
            taskId: localTask.id,
            error: formatError(err)
          })
          onSyncError?.('createTask', 'network')
        })

      return localTask
    },
    async createTag(tag: string, boardId: string = 'main') {
      logger.info('[api] createTag: Starting', { tag, boardId })
      const result = await localStorage.createTag(tag, boardId)
      logger.info('[api] createTag: Created locally', { tag, boardId })

      backgroundSync(
        `/task/api/tags`,
        {
          method: 'POST',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ boardId, tag })
        },
        'createTag',
        { tag, boardId },
        onSyncError
      )
      return result
    },
    async deleteTag(tag: string, boardId: string = 'main') {
      logger.info('[api] deleteTag: Starting', { tag, boardId })
      const result = await localStorage.deleteTag(tag, boardId)
      logger.info('[api] deleteTag: Deleted locally', { tag, boardId })

      backgroundSync(
        `/task/api/tags/delete`,
        {
          method: 'POST',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ boardId, tag })
        },
        'deleteTag',
        { tag, boardId },
        onSyncError
      )
      return result
    },

    async patchTask(
      id: string,
      patch: TaskPatch,
      boardId: string = 'main',
      suppressBroadcast: boolean = false
    ) {
      logger.info('[api] patchTask: Starting', {
        taskId: id,
        boardId,
        patch: Object.keys(patch),
        suppressBroadcast
      })

      // The tag-edit path reaches the same lane enforcement a drag does, so a
      // refusal is expected here too. Snapshot only the fields this patch touches
      // — re-applying the whole task would clobber anything else changed since.
      const prior = await snapshot(boardId, id)
      const undoPatch = prior
        ? (Object.fromEntries(
            Object.keys(patch).map(k => [
              k,
              (prior as unknown as Record<string, unknown>)[k] ?? null
            ])
          ) as TaskPatch)
        : null

      const result = await localStorage.patchTask(id, patch, boardId, suppressBroadcast)
      logger.info('[api] patchTask: Patched locally', { taskId: id, boardId })

      backgroundSync(
        `/task/api/${id}`,
        {
          method: 'PATCH',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ ...patch, boardId })
        },
        'patchTask',
        { taskId: id, boardId },
        onSyncError,
        undoPatch
          ? async () => {
              await localStorage.patchTask(id, undoPatch, boardId, suppressBroadcast)
              return true
            }
          : undefined
      )
      return result
    },

    async completeTask(id: string, boardId: string = 'main') {
      logger.info('[api] completeTask: Starting', { taskId: id, boardId })
      const result = await localStorage.completeTask(id, boardId)
      logger.info('[api] completeTask: Completed locally', { taskId: id, boardId })

      // boardId must be passed as query parameter per OpenAPI spec
      const completeUrl = `/task/api/${id}/complete?boardId=${encodeURIComponent(boardId)}`
      backgroundSync(
        completeUrl,
        {
          method: 'POST',
          headers: adminHeaders(userType, sessionId)
        },
        'completeTask',
        { taskId: id, boardId },
        onSyncError,
        // Completing TOGGLES (the handler reopens an already-completed task), so
        // the inverse of a complete is another complete. Exact in both directions.
        async () => {
          await localStorage.completeTask(id, boardId)
          return true
        }
      )
      return result
    },

    async deleteTask(id: string, boardId: string = 'main', suppressBroadcast: boolean = false) {
      logger.info('[api] deleteTask: Starting', { taskId: id, boardId, suppressBroadcast })
      // The local delete hands back what it removed, which is the only record of
      // the task once it is gone.
      const removed = await localStorage.deleteTask(id, boardId, suppressBroadcast)
      logger.info('[api] deleteTask: Deleted locally', { taskId: id, boardId })

      // boardId must be passed as query parameter per OpenAPI spec
      const deleteUrl = `/task/api/${id}?boardId=${encodeURIComponent(boardId)}`
      backgroundSync(
        deleteUrl,
        {
          method: 'DELETE',
          headers: adminHeaders(userType, sessionId)
        },
        'deleteTask',
        { taskId: id, boardId },
        onSyncError,
        // The one undo that has to REBUILD rather than reverse. CreateTaskInput
        // carries no `state`, so a completed task comes back Active and is toggled
        // shut again; `closedAt` is re-stamped rather than preserved. Everything
        // the board renders — id, title, notes, tag, schedule, metadata, createdAt
        // — survives, and the alternative (leaving a task deleted that the server
        // still holds) loses it entirely until the next full sync.
        removed
          ? async () => {
              await localStorage.createTask(
                {
                  id: removed.id,
                  title: removed.title,
                  notes: removed.notes ?? null,
                  tag: removed.tag ?? undefined,
                  createdAt: removed.createdAt,
                  date: removed.date ?? null,
                  startTime: removed.startTime ?? null,
                  endTime: removed.endTime ?? null,
                  metadata: removed.metadata ?? null
                },
                boardId,
                suppressBroadcast
              )
              if (removed.state === 'Completed') {
                await localStorage.completeTask(id, boardId)
              }
              return true
            }
          : undefined,
        // A delete is idempotent: 404 means the task is already gone, which is
        // exactly what was asked for. Never resurrect it.
        true
      )
    }
  }
}
