/**
 * Hook for managing task operations
 */

import { useState, useEffect, useMemo } from 'react'
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

  async function initialLoad() {
    logger.info('[useTasks] initialLoad called')
    // ✅ Sync from API first (only on initial load, if not public mode)
    if ('syncFromApi' in api) {
      await api.syncFromApi()
    }
    // Then reload from localStorage
    await reload()
  }

  async function reload() {
    logger.info('[useTasks] reload called', {
      currentBoardId,
      stack: new Error().stack?.split('\n').slice(1, 4).join('\n')
    })
    const bf = await api.getBoards()
    setBoards(bf)
    const { tasks: boardTasks } = extractBoardTasks(bf, currentBoardId)
    setTasks(boardTasks)
  }

  // ✅ FIX: Clear state and reload when user context changes
  useEffect(() => {
    logger.info('[useTasks] User context changed, clearing state and reloading', {
      userType,
      sessionId
    })
    setTasks([])
    setPendingOperations(new Set())
    setBoards(null)
    setCurrentBoardId('main')
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userType, sessionId])

  // Listen for broadcasted updates about tasks or boards
  useEffect(() => {
    logger.info('[useTasks] Setting up BroadcastChannel listener', {
      currentBoardId,
      userType,
      sessionId
    })
    try {
      const bcListener = new BroadcastChannel('tasks')
      bcListener.onmessage = e => {
        const msg = e.data || {}
        logger.info('[useTasks] BroadcastChannel message received', {
          msg,
          sessionId: SESSION_ID,
          currentBoardId,
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
            currentBoardId
          })
          void reload()
        }
      }
      return () => {
        logger.info('[useTasks] Cleaning up BroadcastChannel listener', { currentBoardId })
        bcListener.close()
      }
    } catch (err) {
      logger.error('[useTasks] Failed to setup BroadcastChannel', {
        error: formatError(err)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBoardId, userType, sessionId])

  async function addTask(
    input: string,
    schedule?: { startTime?: string | null; endTime?: string | null }
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
    // Switch to the new board first, then reload
    setCurrentBoardId(boardId)
    // Fetch the boards and set tasks for the new board
    const bf = await api.getBoards()
    setBoards(bf)
    const { tasks: boardTasks } = extractBoardTasks(bf, boardId)
    setTasks(boardTasks)
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
      setCurrentBoardId(targetBoardId)
      const bf = await api.getBoards()
      setBoards(bf)
      const { tasks: boardTasks } = extractBoardTasks(bf, targetBoardId)
      setTasks(boardTasks)
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
    // If we're deleting the current board, switch to main and load its tasks
    if (currentBoardId === boardId) {
      setCurrentBoardId('main')
      // Fetch boards and explicitly load main board's tasks
      const bf = await api.getBoards()
      setBoards(bf)
      const { tasks: boardTasks } = extractBoardTasks(bf, 'main')
      setTasks(boardTasks)
    } else {
      // If we're not on the deleted board, just reload normally
      await reload()
    }
  }

  async function createTagOnBoard(tag: string) {
    await api.createTag(tag, currentBoardId)
    await reload()
  }

  async function deleteTagOnBoard(tag: string) {
    await api.deleteTag(tag, currentBoardId)
    await reload()
  }

  function switchBoard(boardId: string) {
    setCurrentBoardId(boardId)
    const { tasks: boardTasks, foundBoard } = extractBoardTasks(boards, boardId)
    if (foundBoard) {
      setTasks(boardTasks)
    } else {
      // Board not present in memory (race) - reload from API
      void reload()
    }
  }

  return {
    // Task state
    tasks,
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

    // Board state
    boards,
    currentBoardId,

    // Board operations
    createBoard,
    deleteBoard,
    switchBoard,
    moveTasksToBoard,
    createTagOnBoard,
    deleteTagOnBoard,

    // Lifecycle
    initialLoad,
    reload
  }
}
