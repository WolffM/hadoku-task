import type {
  TasksFile,
  BoardsFile,
  Task,
  CreateTaskInput,
  ActionableScan,
  AutomationPreset,
  PresetSourceStatus,
  PresetUpdate
} from '../domain/types'
import { createLocalStorageApi } from './localStorageApi'
import { formatError } from '../domain/utils/tags'
import { logger } from '@wolffm/logger/client'

// Type for task updates (partial Task without id and createdAt)
type TaskPatch = Partial<Omit<Task, 'id' | 'createdAt'>>

// Helper for performance timing
function now(): number {
  if (
    typeof window !== 'undefined' &&
    window.performance &&
    typeof window.performance.now === 'function'
  ) {
    return window.performance.now()
  }
  return Date.now()
}

/**
 * Sync API boards data to localStorage
 * Updates localStorage to match server state for offline access and cross-tab consistency
 */
async function syncBoardsToLocalStorage(
  localApi: ReturnType<typeof createLocalStorageApi>,
  apiData: BoardsFile,
  userType: string,
  sessionId: string
) {
  // For each board in API response, update localStorage
  for (const board of apiData.boards || []) {
    const boardId = board.id

    // Update tasks for this board (always write, even if empty - to clear completed tasks)
    const tasksKey = `${userType}-${sessionId}-${boardId}-tasks`
    const tasksFile: TasksFile = {
      version: 1,
      updatedAt: apiData.updatedAt || new Date().toISOString(),
      tasks: board.tasks || []
    }
    window.localStorage.setItem(tasksKey, JSON.stringify(tasksFile))

    // Update stats for this board if present
    if (board.stats) {
      const statsKey = `${userType}-${sessionId}-${boardId}-stats`
      window.localStorage.setItem(statsKey, JSON.stringify(board.stats))
    }
  }

  // Update boards index. Persist the FULL board metadata (handle, ownerUserId,
  // access, pinned, position, mode, lanes, repo, schema…), stripping only the
  // bulky per-board tasks/stats — those live under their own keys (above). The
  // index used to keep just {id,name,tags}, so the cache-first paint rendered a
  // DEGRADED board set (no pins, no automation lanes, no sharing metadata) until
  // the network sync repainted — a visible two-stage flicker. Keeping every
  // field makes the cached paint structurally identical to the server's.
  const boardsKey = `${userType}-${sessionId}-boards`
  const boardsIndex = {
    version: 1,
    updatedAt: apiData.updatedAt || new Date().toISOString(),
    boards: (apiData.boards || []).map(({ tasks: _tasks, stats: _stats, ...meta }) => ({
      ...meta,
      tags: meta.tags || []
    }))
  }
  window.localStorage.setItem(boardsKey, JSON.stringify(boardsIndex))

  logger.info('[api] Synced API data to localStorage', {
    boards: apiData.boards?.length || 0,
    totalTasks: apiData.boards?.reduce((sum, b) => sum + (b.tasks?.length || 0), 0) || 0
  })
}

function adminHeaders(userType: string, sessionId?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-User-Type': userType
  }
  if (sessionId) headers['X-Session-Id'] = sessionId
  return headers
}

/**
 * What the server said when it refused a background sync, when it said anything
 * useful. Without this a reporter can only say "something was rejected" — and for
 * a refusal the user caused and can act on (moving a task into a lane only the
 * agent may write), naming the reason is the whole difference between a usable
 * message and a shrug.
 */
export interface SyncErrorDetail {
  status: number
  /** The domain error code, e.g. `LANE_NOT_EDITABLE`. */
  code?: string
  /** The server's human-readable message, safe to show as-is. */
  message?: string
  /** The optimistic local write was rolled back, so the UI now matches the server. */
  reverted?: boolean
}

export type SyncErrorReporter = (
  operation: string,
  reason: 'http-error' | 'network',
  detail?: SyncErrorDetail
) => void

/**
 * A 4xx the server will give the same answer to however many times we ask —
 * the write is wrong, not the moment. `408`/`429` are the exceptions: both mean
 * "ask again", so they belong with the transient failures.
 *
 * This is the line an optimistic client has to draw somewhere: local state is
 * normally the source of truth and a failed sync is retried, but a definitive
 * refusal makes the local copy the WRONG one, and keeping it shows the user a
 * change that did not happen.
 */
function isDefinitiveRefusal(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429
}

/** Read a domain error body without letting a non-JSON response become a second failure. */
async function readErrorDetail(r: globalThis.Response): Promise<SyncErrorDetail> {
  const detail: SyncErrorDetail = { status: r.status }
  try {
    const body = (await r.json()) as { error?: unknown; code?: unknown }
    if (typeof body?.code === 'string') detail.code = body.code
    if (typeof body?.error === 'string') detail.message = body.error
  } catch {
    /* an HTML error page or empty body — the status alone is what we have */
  }
  return detail
}

/**
 * Undo an optimistic local write the server then refused. Returns true when the
 * local state now matches the server's.
 *
 * Every one of these is a targeted inverse rather than a full `syncFromApi()`,
 * deliberately: a resync is authoritative but it overwrites EVERY board, which
 * would discard any other optimistic write still in flight. The narrow undo only
 * touches what this call changed.
 */
type Undo = () => Promise<boolean> | boolean

/**
 * The refused-sync path, shared by `backgroundSync` and by `createTask`'s
 * hand-rolled fetch (which reads the server's id and so can't use the generic
 * helper). Reads the reason, undoes the write when the refusal is definitive, and
 * reports both in one call.
 */
async function reportRefusal(
  r: globalThis.Response,
  operation: string,
  context: Record<string, unknown>,
  onError?: SyncErrorReporter,
  undo?: Undo
): Promise<void> {
  const detail = await readErrorDetail(r)
  logger.warn(`[api] ${operation}: Server sync returned error`, {
    status: r.status,
    code: detail.code,
    ...context
  })
  if (undo && isDefinitiveRefusal(r.status)) {
    try {
      detail.reverted = (await undo()) === true
      if (detail.reverted) {
        logger.info(`[api] ${operation}: reverted the optimistic write`, context)
      }
    } catch (revertErr) {
      // A failed undo leaves local ahead of the server — bad, but the reload the
      // reporter would have triggered is exactly what a resync fixes, and dying
      // here would also swallow the user-facing message.
      logger.error(`[api] ${operation}: could not revert the optimistic write`, {
        ...context,
        error: formatError(revertErr)
      })
    }
  }
  onError?.(operation, 'http-error', detail)
}

/**
 * Fire-and-forget server sync with consistent logging.
 * Used for optimistic updates where localStorage is source of truth.
 *
 * `undo` runs for a definitive 4xx before the error is reported, so the local
 * write is already rolled back by the time the user reads why.
 */
function backgroundSync(
  url: string,
  options: globalThis.RequestInit,
  operation: string,
  context: Record<string, unknown>,
  onError?: SyncErrorReporter,
  undo?: Undo
): void {
  fetch(url, options)
    .then(async r => {
      if (!r.ok) {
        await reportRefusal(r, operation, context, onError, undo)
      } else {
        logger.info(`[api] ${operation}: Server sync completed`, context)
      }
      return r
    })
    .catch(err => {
      logger.error(`[api] ${operation}: Server sync failed`, {
        ...context,
        error: formatError(err)
      })
      onError?.(operation, 'network')
    })
}

/**
 * Create optimistic API client
 * - All user types use localStorage for immediate updates
 * - "public" is localStorage-only, no server sync
 * - All other user types (friend, admin, custom names) sync to server in background
 */
export interface CreateApiOptions {
  onSyncError?: SyncErrorReporter
}

/**
 * Tiers this client distinguishes. Only `public` branches (localStorage-only);
 * every other tier syncs to the server, which is why the union can be widened
 * without touching a single call site. Kept complete anyway — a tier missing
 * here becomes a cast at every caller, which is how `service` went unlisted
 * for months while being passed in at runtime.
 */
export type TaskUserTier = 'public' | 'friend' | 'service' | 'wife' | 'admin'

export function createApi(
  userType: TaskUserTier = 'public',
  sessionId: string = 'public',
  apiOptions: CreateApiOptions = {}
) {
  const localStorage = createLocalStorageApi(userType, sessionId)
  const onSyncError = apiOptions.onSyncError

  // Public mode: localStorage only, no server sync
  if (userType === 'public') {
    return localStorage
  }

  /**
   * The locally-cached task, read before an optimistic write so a refusal can put
   * it back. Never throws — an unreadable cache means no undo, which is strictly
   * better than no write.
   */
  const snapshot = async (boardId: string, taskId: string): Promise<Task | null> => {
    try {
      const bf = await localStorage.getBoards()
      const board = bf.boards.find(b => b.id === boardId)
      return board?.tasks?.find(t => t.id === taskId) ?? null
    } catch (err) {
      logger.warn('[api] could not snapshot the task before writing', {
        boardId,
        taskId,
        error: formatError(err)
      })
      return null
    }
  }

  // All other modes: Optimistic localStorage with explicit API sync on initial load only
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
          : undefined
      )
    },

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
    },

    // --- Board sharing (§7). These are server-only (no localStorage mirror). ---

    /** Autocomplete: live display names matching `q` (safe to expose). */
    async searchUsers(q: string): Promise<Array<{ name: string; tier?: string }>> {
      if (!q.trim()) return []
      try {
        const res = await fetch(`/task/api/users/search?q=${encodeURIComponent(q)}`, {
          headers: adminHeaders(userType, sessionId)
        })
        if (!res.ok) return []
        const data = (await res.json()) as { users?: Array<{ name: string; tier?: string }> }
        return data.users ?? []
      } catch {
        return []
      }
    },

    /** List a board's grantees (owner only), annotated with display name + tier. */
    async listShares(boardRef: string): Promise<
      Array<{
        granteeUserId: string
        name?: string | null
        tier?: string | null
        level: string
        createdAt: string
      }>
    > {
      try {
        const res = await fetch(`/task/api/boards/${encodeURIComponent(boardRef)}/shares`, {
          headers: adminHeaders(userType, sessionId)
        })
        if (!res.ok) return []
        const data = (await res.json()) as {
          shares?: Array<{
            granteeUserId: string
            name?: string | null
            tier?: string | null
            level: string
            createdAt: string
          }>
        }
        return data.shares ?? []
      } catch {
        return []
      }
    },

    /** Grant (or update) a share by display name. Returns the echo or an error. */
    async grantShare(
      boardRef: string,
      input: { name?: string; userId?: string; level: 'readonly' | 'contributor' }
    ): Promise<{
      ok: boolean
      error?: string
      granted?: { name: string | null; tier: string | null; level: string }
    }> {
      try {
        const res = await fetch(`/task/api/boards/${encodeURIComponent(boardRef)}/shares`, {
          method: 'POST',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify(input)
        })
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
          granted?: { name: string | null; tier: string | null; level: string }
        }
        if (!res.ok) return { ok: false, error: data.error ?? `Error ${res.status}` }
        return { ok: true, granted: data.granted }
      } catch {
        return { ok: false, error: 'Network error' }
      }
    },

    /** Revoke a grantee's access (owner only). */
    async revokeShare(boardRef: string, granteeUserId: string): Promise<boolean> {
      try {
        const res = await fetch(
          `/task/api/boards/${encodeURIComponent(boardRef)}/shares/${encodeURIComponent(granteeUserId)}`,
          { method: 'DELETE', headers: adminHeaders(userType, sessionId) }
        )
        return res.ok
      } catch {
        return false
      }
    },

    /**
     * The lane contracts our providers publish (§5.4). The worker fetches them
     * from the provider and validates them, so this is a plain read: the picker
     * offers a live schema instead of asking a human to paste one.
     */
    async listAutomationPresets(): Promise<{
      presets: AutomationPreset[]
      sources: PresetSourceStatus[]
    }> {
      try {
        const res = await fetch('/task/api/automation/presets', {
          headers: adminHeaders(userType, sessionId)
        })
        if (!res.ok) return { presets: [], sources: [] }
        return (await res.json()) as { presets: AutomationPreset[]; sources: PresetSourceStatus[] }
      } catch {
        return { presets: [], sources: [] }
      }
    },

    /**
     * What this board's repo has open that the pipeline could take on (§5.6).
     * The worker asks TenHands with its own service key; we just read the list.
     *
     * Called on every board load, so a failure has to be quiet and legible:
     * `ok:false` + a reason, never a throw the board load has to survive. The
     * caller shows nothing on `ok:false` — an outage must not render as "there
     * is nothing left to automate".
     */
    async listActionable(boardRef: string): Promise<ActionableScan> {
      try {
        const res = await fetch(
          `/task/api/boards/${encodeURIComponent(boardRef)}/actionable`,
          { headers: adminHeaders(userType, sessionId) }
        )
        // 403 (read-only) and 404 (no such board) are answers, not faults — the
        // reason carries the status so a support question has something to go on.
        if (!res.ok) return { ok: false, repo: null, items: [], reason: `http_${res.status}` }
        return (await res.json()) as ActionableScan
      } catch {
        return { ok: false, repo: null, items: [], reason: 'network' }
      }
    },

    /**
     * Whether this board's lane set is behind the contract it was activated from
     * (§5.5). The worker computes it from its cached copy of the provider's
     * contract, so this is a plain read of the hydrated board. Null when the
     * board is current — or when the worker's preset cache is cold, which
     * resolves itself on the next read.
     */
    async getPresetUpdate(boardRef: string): Promise<PresetUpdate | null> {
      try {
        const res = await fetch(`/task/api/boards/${encodeURIComponent(boardRef)}`, {
          headers: adminHeaders(userType, sessionId)
        })
        if (!res.ok) return null
        const data = (await res.json()) as { board?: { presetUpdate?: PresetUpdate } }
        return data.board?.presetUpdate ?? null
      } catch {
        return null
      }
    },

    /**
     * Activate (or preview) automation on a board (owner only, §5.4). Pass
     * `dryRun: true` for a preview + digest; echo that digest to commit. Returns
     * the raw result (preview/applied) or an error.
     */
    async activateAutomation(
      boardRef: string,
      payload: {
        lanes: unknown
        schemaId?: string | null
        schemaVersion?: number | null
        repo?: string | null
        dryRun?: boolean
        digest?: string
      }
    ): Promise<{ ok: boolean; error?: string; code?: string; result?: unknown }> {
      try {
        const res = await fetch(
          `/task/api/boards/${encodeURIComponent(boardRef)}/activate-automation`,
          {
            method: 'POST',
            headers: adminHeaders(userType, sessionId),
            body: JSON.stringify(payload)
          }
        )
        const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
        if (!res.ok)
          return { ok: false, error: data.error ?? `Error ${res.status}`, code: data.code }
        return { ok: true, result: data }
      } catch {
        return { ok: false, error: 'Network error' }
      }
    },

    /** Deactivate automation, restoring the standard tag list (owner only). */
    async deactivateAutomation(boardRef: string): Promise<{ ok: boolean; error?: string }> {
      try {
        const res = await fetch(
          `/task/api/boards/${encodeURIComponent(boardRef)}/deactivate-automation`,
          {
            method: 'POST',
            headers: adminHeaders(userType, sessionId)
          }
        )
        if (!res.ok) return { ok: false, error: `Error ${res.status}` }
        return { ok: true }
      } catch {
        return { ok: false, error: 'Network error' }
      }
    },

    /** Persist a board's repo (owner only). Auto-called on successful validation. */
    async setRepo(boardRef: string, repo: string): Promise<{ ok: boolean; repo?: string | null }> {
      try {
        const res = await fetch(`/task/api/boards/${encodeURIComponent(boardRef)}/repo`, {
          method: 'POST',
          headers: adminHeaders(userType, sessionId),
          body: JSON.stringify({ repo })
        })
        if (!res.ok) return { ok: false }
        return (await res.json()) as { ok: boolean; repo?: string | null }
      } catch {
        return { ok: false }
      }
    },

    /** Validate a repo (owner/name) by probing GitHub through the worker. */
    async validateRepo(repo: string): Promise<{
      repo: string
      valid: boolean
      reason: string
      private?: boolean
      defaultBranch?: string
      message?: string
    }> {
      try {
        const res = await fetch(`/task/api/repos/validate?repo=${encodeURIComponent(repo)}`, {
          headers: adminHeaders(userType, sessionId)
        })
        if (!res.ok) return { repo, valid: false, reason: 'error', message: `Error ${res.status}` }
        return (await res.json()) as {
          repo: string
          valid: boolean
          reason: string
          private?: boolean
          defaultBranch?: string
          message?: string
        }
      } catch {
        return { repo, valid: false, reason: 'error', message: 'Network error' }
      }
    },

    // User preferences moved to @wolffm/prefs-client (src/prefs/taskPrefs.ts).
    // The legacy GET/PUT /task/api/preferences path is gone from the client;
    // the worker route is retained for the 30d migration window (Tranche B).

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
    },

    // User Management
    async validateKey(key: string): Promise<boolean> {
      logger.info('[api] validateKey: Starting')
      try {
        const response = await fetch('/task/api/validate-key', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Key': key
          }
        })
        const isValid = response.ok
        logger.info('[api] validateKey: Completed', { isValid })
        return isValid
      } catch (err) {
        logger.error('[api] validateKey: Failed', {
          error: formatError(err)
        })
        return false
      }
    }
  }
}
