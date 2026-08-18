/**
 * The task API client.
 *
 * `createApi` picks the branch — a public user gets the localStorage-only client
 * and never syncs — then composes the method groups. The groups live beside this
 * file (client-tasks, client-boards, client-sharing, client-automation,
 * client-batch, client-misc) and share the closure through ApiCtx; the shape of
 * the object returned here is what src/test/api-client-verify.ts pins.
 */
import { createLocalStorageApi } from './localStorageApi'
import { formatError } from '../domain/utils/tags'
import { logger } from '@wolffm/logger/client'
import type { Task } from '../domain/types'
import type { ApiCtx } from './client-context'
import { taskMethods } from './client-tasks'
import { boardMethods } from './client-boards'
import { shareMethods } from './client-sharing'
import { automationMethods } from './client-automation'
import { batchMethods } from './client-batch'
import { miscMethods } from './client-misc'

// Re-exported because App.tsx and useTasks import them from here; ApiCtx is
// deliberately NOT among them — every method group takes it straight from
// client-context, and re-exporting it here just made a second public name for
// an internal seam.
export type {
  SyncErrorDetail,
  SyncErrorReporter,
  CreateApiOptions,
  TaskUserTier
} from './client-context'
import type { CreateApiOptions, TaskUserTier } from './client-context'

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

  const ctx: ApiCtx = { userType, sessionId, localStorage, onSyncError, snapshot }

  // Spread, not nested: the returned object is one flat surface of 27 methods,
  // which is what every caller and the characterization harness expect.
  return {
    ...taskMethods(ctx),
    ...boardMethods(ctx),
    ...shareMethods(ctx),
    ...automationMethods(ctx),
    // User preferences moved to @wolffm/prefs-client (src/prefs/taskPrefs.ts).
    // The legacy GET/PUT /task/api/preferences path is gone from the client;
    // the worker route is retained for the 30d migration window (Tranche B).
    ...batchMethods(ctx),
    ...miscMethods(ctx)
  }
}
