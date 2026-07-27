/**
 * Hook for managing task operations
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createApi, type SyncErrorReporter } from '../../api/client'
import type { Task, BoardsFile } from '../../domain/types'
import { parseTaskInput, splitTags, formatError } from '../../domain/utils/tags'
import { SESSION_ID } from '../../api/session'
import { withPendingOperation, extractBoardTasks } from './helpers'
import { logger } from '@wolffm/logger/client'

interface UseTasksProps {
  userType: string
  // sessionId from parent
  sessionId?: string
  onSyncError?: SyncErrorReporter
}

export function useTasks({ userType, sessionId, onSyncError }: UseTasksProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [pendingOperations, setPendingOperations] = useState<Set<string>>(new Set())
  // ✅ FIX: Recreate API when userType or sessionId changes
  const api = useMemo(
    () =>
      createApi(userType as 'public' | 'friend' | 'admin', sessionId || 'public', { onSyncError }),
    [userType, sessionId, onSyncError]
  )
  const [boards, setBoards] = useState<BoardsFile | null>(null)
  const [currentBoardId, setCurrentBoardId] = useState<string>('main')

  // `reload` runs async and is often kicked off unawaited (mount, BroadcastChannel,
  // mutations). Reading the selected board from state would capture whatever was
  // selected when the closure was created, so a board switch during an in-flight
  // load would render the *previous* board's tasks. The ref always holds the live
  // selection, so a load that resolves after a switch slices the correct board.
  const currentBoardIdRef = useRef(currentBoardId)
  const selectBoard = useCallback((boardId: string) => {
    currentBoardIdRef.current = boardId
    setCurrentBoardId(boardId)
  }, [])

  // Monotonic counter so a slow reload can't clobber the results of a newer one.
  const reloadSeqRef = useRef(0)

  // True once the first board paint (from cache) has landed, so the shell can
  // reveal with content instead of gating on the slower network round-trip.
  const [boardsLoaded, setBoardsLoaded] = useState(false)

  // Force a fresh network sync, then repaint. Used by the refresh button and
  // pull-to-refresh. The mount effect below uses a cache-first variant so the
  // first paint doesn't wait on the network.
  async function initialLoad() {
    logger.info('[useTasks] initialLoad called')
    if ('syncFromApi' in api) {
      await api.syncFromApi()
    }
    await reload()
  }

  async function reload() {
    const seq = ++reloadSeqRef.current
    logger.info('[useTasks] reload called', { currentBoardId: currentBoardIdRef.current, seq })

    const bf = await api.getBoards()

    // A newer reload started while this one was awaiting — its result wins.
    if (seq !== reloadSeqRef.current) {
      logger.info('[useTasks] reload superseded, discarding stale result', {
        seq,
        latest: reloadSeqRef.current
      })
      return
    }

    setBoards(bf)
    const { tasks: boardTasks } = extractBoardTasks(bf, currentBoardIdRef.current)
    setTasks(boardTasks)
  }

  // Single owner of the board-load lifecycle. On a user-context change: clear the
  // previous user's data, paint from the (now faithful) cache immediately so the
  // shell reveals with content, THEN revalidate from the network and repaint.
  //
  // This used to be split across two hooks — this effect painted the cache while
  // useSessionInitialization separately kicked its own syncFromApi + reload. The
  // two raced through reloadSeqRef and, worse, this effect's setBoards(null)
  // clear could land AFTER the other path had already painted, blanking the
  // board. Owning the whole clear→paint→revalidate sequence in one place removes
  // that race (the "shaky" load) and keeps the network off the reveal path.
  useEffect(() => {
    logger.info('[useTasks] User context changed: reset + load', { userType, sessionId })
    setBoardsLoaded(false)
    setTasks([])
    setPendingOperations(new Set())
    setBoards(null)
    selectBoard('main')
    void (async () => {
      // Fast cache paint (localStorage for authed users). Reveal the shell even
      // if this throws — a corrupt cache must never trap the user on the
      // skeleton forever; the network revalidate below still runs.
      try {
        await reload()
      } catch (err) {
        logger.warn('[useTasks] initial cache paint failed', { error: String(err) })
      } finally {
        setBoardsLoaded(true) // content on screen → App may reveal the shell
      }
      if ('syncFromApi' in api) {
        try {
          await api.syncFromApi() // network → refreshes the faithful cache
          await reload() // seamless repaint with server truth
        } catch (err) {
          logger.warn('[useTasks] background board sync failed', { error: String(err) })
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userType, sessionId])

  // Listen for broadcasted updates about tasks or boards.
  //
  // Keyed on the user context only — NOT on currentBoardId. The handler doesn't
  // need it (reload() reads the live board from currentBoardIdRef), so including
  // it just tore the channel down and rebuilt it on every board switch.
  useEffect(() => {
    logger.info('[useTasks] Setting up BroadcastChannel listener', { userType, sessionId })
    try {
      const bcListener = new BroadcastChannel('tasks')
      bcListener.onmessage = e => {
        const msg = e.data || {}
        logger.info('[useTasks] BroadcastChannel message received', {
          msg,
          sessionId: SESSION_ID,
          currentBoardId: currentBoardIdRef.current,
          currentContext: { userType, sessionId }
        })

        // Ignore messages from the same session to prevent infinite loops
        if (msg.sessionId === SESSION_ID) {
          logger.info('[useTasks] Ignoring own broadcast message')
          return
        }

        // ✅ FIX: Only respond to messages for the current user context
        if (msg.userType !== userType || msg.sessionId !== sessionId) {
          logger.info('[useTasks] Ignoring message for different user context', {
            msgContext: { userType: msg.userType, sessionId: msg.sessionId },
            currentContext: { userType, sessionId }
          })
          return
        }

        if (msg.type === 'tasks-updated' || msg.type === 'boards-updated') {
          logger.info('[useTasks] BroadcastChannel: triggering reload for currentBoardId', {
            currentBoardId: currentBoardIdRef.current
          })
          void reload()
        }
      }
      return () => {
        logger.info('[useTasks] Cleaning up BroadcastChannel listener')
        bcListener.close()
      }
    } catch (err) {
      logger.error('[useTasks] Failed to setup BroadcastChannel', {
        error: formatError(err)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userType, sessionId])

  async function addTask(
    input: string,
    schedule?: { date?: string | null; startTime?: string | null; endTime?: string | null }
  ) {
    input = input.trim()
    if (!input) return

    try {
      const parsed = parseTaskInput(input)
      await api.createTask({ ...parsed, ...schedule }, currentBoardId)
      await reload()
      return true
    } catch (error) {
      alert((error as Error).message || 'Failed to create task')
      return false
    }
  }

  // Reschedule a task by patching its calendar times (used by the calendar view's
  // drag-to-move). Goes through the same patchTask path as tag edits.
  async function rescheduleTask(
    taskId: string,
    schedule: { startTime: string | null; endTime: string | null }
  ) {
    await withPendingOperation(
      `reschedule-${taskId}`,
      pendingOperations,
      setPendingOperations,
      async () => {
        await api.patchTask(taskId, schedule, currentBoardId)
        await reload()
      },
      {
        onError: error => alert(error.message || 'Failed to reschedule task')
      }
    )
  }

  async function completeTask(taskId: string) {
    await withPendingOperation(
      `complete-${taskId}`,
      pendingOperations,
      setPendingOperations,
      async () => {
        await api.completeTask(taskId, currentBoardId)
        await reload()
      },
      {
        onError: error => alert(error.message || 'Failed to complete task')
      }
    )
  }

  async function deleteTask(taskId: string) {
    logger.info('[useTasks] deleteTask START', { taskId, currentBoardId })
    await withPendingOperation(
      `delete-${taskId}`,
      pendingOperations,
      setPendingOperations,
      async () => {
        logger.info('[useTasks] deleteTask: calling api.deleteTask', { taskId, currentBoardId })
        await api.deleteTask(taskId, currentBoardId)
        logger.info('[useTasks] deleteTask: calling reload')
        await reload()
        logger.info('[useTasks] deleteTask END')
      },
      {
        onError: error => alert(error.message || 'Failed to delete task')
      }
    )
  }

  async function addTagToTask(taskId: string) {
    const newTag = prompt('Enter tag (without #):')
    if (!newTag) return

    // Normalize tag: remove any leading '#' characters, trim, convert spaces to hyphens
    const normalizedTag = newTag.trim().replace(/^#+/, '').replace(/\s+/g, '-')

    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    const existingTags = splitTags(task.tag)
    if (existingTags.includes(normalizedTag)) return

    const updatedTags = [...existingTags, normalizedTag].join(' ')

    try {
      await api.patchTask(taskId, { tag: updatedTags }, currentBoardId)
      await reload()
    } catch (error) {
      alert((error as Error).message || 'Failed to add tag')
    }
  }

  // updateTaskTags now returns an object with suppressBroadcast and skipReload options
  async function updateTaskTags(
    taskId: string,
    updates: { tag: string },
    options: { suppressBroadcast?: boolean; skipReload?: boolean } = {}
  ) {
    const { suppressBroadcast = false, skipReload = false } = options
    await api.patchTask(taskId, updates, currentBoardId, suppressBroadcast)
    if (!skipReload) {
      await reload()
    }
  }

  // Helper for bulk tag updates - uses batch endpoint to avoid race conditions
  async function bulkUpdateTaskTags(updates: Array<{ taskId: string; tag: string }>) {
    logger.info('[useTasks] bulkUpdateTaskTags START', { count: updates.length })
    try {
      // Use batch API (available in all modes - localStorage and friend/admin)
      await api.batchUpdateTags(
        currentBoardId,
        updates.map(u => ({ taskId: u.taskId, tag: u.tag || null }))
      )

      logger.info('[useTasks] bulkUpdateTaskTags: calling reload')
      await reload()
      logger.info('[useTasks] bulkUpdateTaskTags END')
    } catch (error) {
      logger.error('[useTasks] bulkUpdateTaskTags ERROR', {
        error: formatError(error)
      })
      throw error
    }
  }

  async function deleteTag(tag: string) {
    logger.info('[useTasks] deleteTag START', { tag, currentBoardId, taskCount: tasks.length })

    // Check if we have tasks with this tag
    const tagTasks = tasks.filter(t => splitTags(t.tag).includes(tag))
    logger.info('[useTasks] deleteTag: found tasks with tag', { tag, count: tagTasks.length })

    if (tagTasks.length === 0) {
      logger.info('[useTasks] deleteTag: no tasks found with this tag, just deleting tag')
      try {
        await api.deleteTag(tag, currentBoardId)
        await reload()
        logger.info('[useTasks] deleteTag END (no tasks to clear)')
      } catch (error) {
        logger.error('[useTasks] deleteTag ERROR', {
          error: formatError(error)
        })
        // Note: alert() may also be blocked - log instead
        logger.error('[useTasks] deleteTag: Please fix this error', {
          errorMessage: (error as Error).message
        })
      }
      return
    }

    try {
      logger.info('[useTasks] deleteTag: starting batch clear')

      // Use batch API (available in all modes - localStorage and friend/admin)
      await api.batchClearTag(
        currentBoardId,
        tag,
        tagTasks.map(t => t.id)
      )

      logger.info('[useTasks] deleteTag: calling reload')
      await reload()

      logger.info('[useTasks] deleteTag END')
    } catch (error) {
      logger.error('[useTasks] deleteTag ERROR', {
        error: formatError(error)
      })
      alert((error as Error).message || 'Failed to remove tag from tasks')
    }
  }

  // Board helpers
  async function createBoard(boardId: string) {
    await api.createBoard(boardId)
    // Switch first: reload slices against the live selection.
    selectBoard(boardId)
    await reload()
  }

  // Move multiple tasks to another board
  async function moveTasksToBoard(targetBoardId: string, ids: string[]) {
    logger.info('[useTasks] moveTasksToBoard START', { targetBoardId, ids, currentBoardId })
    if (!boards) return

    // Find which boards the tasks are on
    const sourceBoardIds = new Set<string>()
    for (const b of boards.boards) {
      for (const t of b.tasks || []) {
        if (ids.includes(t.id)) {
          sourceBoardIds.add(b.id)
        }
      }
    }

    logger.info('[useTasks] moveTasksToBoard: source boards', {
      sourceBoardIds: Array.from(sourceBoardIds)
    })

    try {
      // Use batch API (available in all modes) if all tasks are from the same board
      if (sourceBoardIds.size === 1) {
        const sourceBoardId = Array.from(sourceBoardIds)[0]
        logger.info('[useTasks] moveTasksToBoard: using batch API')
        await api.batchMoveTasks(sourceBoardId, targetBoardId, ids)
      } else {
        logger.error('[useTasks] moveTasksToBoard: Cannot move tasks from multiple boards at once')
        throw new Error('Cannot move tasks from multiple boards at once')
      }

      // Switch to the target board and reload it
      logger.info('[useTasks] moveTasksToBoard: switching to target board', { targetBoardId })
      selectBoard(targetBoardId)
      await reload()
      logger.info('[useTasks] moveTasksToBoard END')
    } catch (error) {
      logger.error('[useTasks] moveTasksToBoard ERROR', {
        error: formatError(error)
      })
      alert((error as Error).message || 'Failed to move tasks')
    }
  }

  async function deleteBoard(boardId: string) {
    await api.deleteBoard(boardId)
    // If we're deleting the current board, fall back to main before reloading.
    if (currentBoardId === boardId) {
      selectBoard('main')
    }
    await reload()
  }

  async function renameBoard(boardId: string, name: string) {
    await api.renameBoard(boardId, name)
    await reload()
  }

  async function setPinnedBoards(order: string[]) {
    await api.setPinnedBoards(order)
    await reload()
  }

  async function createTagOnBoard(tag: string) {
    await api.createTag(tag, currentBoardId)
    await reload()
  }

  async function deleteTagOnBoard(tag: string) {
    await api.deleteTag(tag, currentBoardId)
    await reload()
  }

  async function setTaskNotes(taskId: string, notes: string) {
    await api.patchTask(taskId, { notes }, currentBoardId)
    await reload()
  }

  /** Rename a task (inline title edit on the card). */
  async function renameTask(taskId: string, title: string) {
    await api.patchTask(taskId, { title }, currentBoardId)
    await reload()
  }

  function switchBoard(boardId: string) {
    selectBoard(boardId)
    const { tasks: boardTasks, foundBoard } = extractBoardTasks(boards, boardId)
    if (foundBoard) {
      setTasks(boardTasks)
    } else {
      // Board not in memory yet (initial load still in flight) — reload will slice
      // this board once it lands, and supersede any load already running.
      void reload()
    }
  }

  // `tasks` carries mixed state — Active plus anything completed in the last 24h,
  // because the board RENDERS completed tasks (struck through) until they close.
  // Anything that COUNTS tasks rather than rendering them wants this instead:
  // lane ranking, tag existence, empty-lane detection, calendar occupancy. A
  // completed task inflating its tag's frequency could push a live lane off a
  // 6-lane board for a day. Pick the variable that names what you mean.
  const activeTasks = useMemo(() => tasks.filter(t => t.state === 'Active'), [tasks])

  // Stable identity: `api` is memoized, so this share facade is too. Without the
  // memo a NEW object every render would re-fire the share UI's autocomplete
  // effect on every render (a fetch storm), never letting a result settle.
  const shareApi = useMemo(
    () => ({
      searchUsers: api.searchUsers,
      listShares: api.listShares,
      grantShare: api.grantShare,
      revokeShare: api.revokeShare,
      listAutomationPresets: api.listAutomationPresets,
      getPresetUpdate: api.getPresetUpdate,
      activateAutomation: api.activateAutomation,
      deactivateAutomation: api.deactivateAutomation,
      validateRepo: api.validateRepo,
      setRepo: api.setRepo
    }),
    [api]
  )

  return {
    // Task state
    tasks,
    activeTasks,
    pendingOperations,

    // Task operations
    addTask,
    rescheduleTask,
    completeTask,
    deleteTask,
    addTagToTask,
    updateTaskTags,
    bulkUpdateTaskTags,
    deleteTag,
    setTaskNotes,
    renameTask,

    // Board state
    boards,
    boardsLoaded,
    currentBoardId,

    // Board operations
    createBoard,
    deleteBoard,
    renameBoard,
    setPinnedBoards,
    switchBoard,
    moveTasksToBoard,
    createTagOnBoard,
    deleteTagOnBoard,

    // Board sharing (§7) — direct server calls, no localStorage mirror.
    shareApi,

    // Lifecycle
    initialLoad,
    reload
  }
}
