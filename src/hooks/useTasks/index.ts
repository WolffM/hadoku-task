/**
 * Hook for managing task operations
 */

import { useState, useEffect, useMemo } from 'react'
import { createApi } from '../../api/client'
import type { Task, TasksFile, BoardsFile } from '../../domain/types'
import { parseTaskInput } from '../../domain/utils/tags'
import { SESSION_ID } from '../../api/session'
import {
  deferredBroadcast,
  withPendingOperation,
  withBulkOperation,
  extractBoardTasks,
} from './helpers'

interface UseTasksProps {
  userType: string
  userId?: string
  sessionId?: string
}

// Re-export SESSION_ID for backwards compatibility
export { SESSION_ID }

export function useTasks({ userType, userId, sessionId }: UseTasksProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [pendingOperations, setPendingOperations] = useState<Set<string>>(new Set())
  // ✅ FIX: Recreate API when userType, userId, or sessionId changes
  const api = useMemo(
    () => createApi(userType as 'public' | 'friend' | 'admin', userId || 'public', sessionId),
    [userType, userId, sessionId]
  )
  const [boards, setBoards] = useState<BoardsFile | null>(null)
  const [currentBoardId, setCurrentBoardId] = useState<string>('main')

  async function initialLoad() {
    console.log('[useTasks] initialLoad called')
    // ✅ Sync from API first (only on initial load, if not public mode)
    if ('syncFromApi' in api) {
      await api.syncFromApi()
    }
    // Then reload from localStorage
    await reload()
  }

  async function reload() {
    console.log('[useTasks] reload called', { currentBoardId, stack: new Error().stack?.split('\n').slice(1, 4).join('\n') })
    const bf = await api.getBoards()
    setBoards(bf)
    const { tasks: boardTasks } = extractBoardTasks(bf, currentBoardId)
    setTasks(boardTasks)
  }

  // ✅ FIX: Clear state and reload when user context changes
  useEffect(() => {
    console.log('[useTasks] User context changed, clearing state and reloading', { userType, userId })
    setTasks([])
    setPendingOperations(new Set())
    setBoards(null)
    setCurrentBoardId('main')
    void reload()
  }, [userType, userId])

  // Listen for broadcasted updates about tasks or boards
  useEffect(() => {
    console.log('[useTasks] Setting up BroadcastChannel listener', { currentBoardId, userType, userId })
    try {
      const bcListener = new BroadcastChannel('tasks')
      bcListener.onmessage = (e) => {
        const msg = e.data || {}
        console.log('[useTasks] BroadcastChannel message received', { msg, sessionId: SESSION_ID, currentBoardId, currentContext: { userType, userId } })
        
        // Ignore messages from the same session to prevent infinite loops
        if (msg.sessionId === SESSION_ID) {
          console.log('[useTasks] Ignoring own broadcast message')
          return
        }
        
        // ✅ FIX: Only respond to messages for the current user context
        if (msg.userType !== userType || msg.userId !== userId) {
          console.log('[useTasks] Ignoring message for different user context', { 
            msgContext: { userType: msg.userType, userId: msg.userId },
            currentContext: { userType, userId }
          })
          return
        }
        
        if (msg.type === 'tasks-updated' || msg.type === 'boards-updated') {
          console.log('[useTasks] BroadcastChannel: triggering reload for currentBoardId =', currentBoardId)
          void reload()
        }
      }
      return () => {
        console.log('[useTasks] Cleaning up BroadcastChannel listener', { currentBoardId })
        bcListener.close()
      }
    } catch (err) {
      console.error('[useTasks] Failed to setup BroadcastChannel', err)
    }
  }, [currentBoardId, userType, userId]) // ✅ FIX: Recreate listener when user context changes

  async function addTask(input: string) {
    input = input.trim()
    if (!input) return
    
    try {
      const parsed = parseTaskInput(input)
      await api.createTask(parsed, currentBoardId)
      await reload()
      return true
    } catch (error) {
      alert((error as Error).message || 'Failed to create task')
      return false
    }
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
        onError: (error) => alert(error.message || 'Failed to complete task'),
      }
    )
  }

  async function deleteTask(taskId: string) {
    console.log('[useTasks] deleteTask START', { taskId, currentBoardId })
    await withPendingOperation(
      `delete-${taskId}`,
      pendingOperations,
      setPendingOperations,
      async () => {
        console.log('[useTasks] deleteTask: calling api.deleteTask', { taskId, currentBoardId })
        await api.deleteTask(taskId, currentBoardId)
        console.log('[useTasks] deleteTask: calling reload')
        await reload()
        console.log('[useTasks] deleteTask END')
      },
      {
        onError: (error) => alert(error.message || 'Failed to delete task'),
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
    
    const existingTags = task.tag?.split(' ') || []
    if (existingTags.includes(normalizedTag)) return // Tag already exists
    
    const updatedTags = [...existingTags, normalizedTag].join(' ')
    
    try {
      await api.patchTask(taskId, { tag: updatedTags }, currentBoardId)
      await reload()
    } catch (error) {
      alert((error as Error).message || 'Failed to add tag')
    }
  }

  // updateTaskTags now returns an object with suppressBroadcast and skipReload options
  async function updateTaskTags(taskId: string, updates: { tag: string }, options: { suppressBroadcast?: boolean, skipReload?: boolean } = {}) {
    const { suppressBroadcast = false, skipReload = false } = options
    try {
      await api.patchTask(taskId, updates, currentBoardId, suppressBroadcast)
      if (!skipReload) {
        await reload()
      }
    } catch (error) {
      throw error
    }
  }
  
  // Helper for bulk tag updates - uses batch endpoint to avoid race conditions
  async function bulkUpdateTaskTags(updates: Array<{ taskId: string, tag: string }>) {
    console.log('[useTasks] bulkUpdateTaskTags START', { count: updates.length })
    try {
      // Use batch API if available
      if ('batchUpdateTags' in api) {
        await api.batchUpdateTags(
          currentBoardId,
          updates.map(u => ({ taskId: u.taskId, tag: u.tag || null }))
        )
      } else {
        // Fallback to old method for public mode
        await withBulkOperation(async () => {
          for (const { taskId, tag } of updates) {
            await api.patchTask(taskId, { tag }, currentBoardId, true)
          }
        }, userType, userId)
      }
      
      console.log('[useTasks] bulkUpdateTaskTags: calling reload')
      await reload()
      console.log('[useTasks] bulkUpdateTaskTags END')
    } catch (error) {
      console.error('[useTasks] bulkUpdateTaskTags ERROR', error)
      throw error
    }
  }

  async function clearTasksByTag(tag: string) {
    console.log('[useTasks] clearTasksByTag START', { tag, currentBoardId, taskCount: tasks.length })
    
    // Check if we have tasks with this tag
    const tagTasks = tasks.filter(t => t.tag?.split(' ').includes(tag))
    console.log('[useTasks] clearTasksByTag: found tasks with tag', { tag, count: tagTasks.length })
    
    if (tagTasks.length === 0) {
      console.log('[useTasks] clearTasksByTag: no tasks found with this tag, just deleting tag')
      try {
        await api.deleteTag(tag, currentBoardId)
        await reload()
        console.log('[useTasks] clearTasksByTag END (no tasks to clear)')
      } catch (error) {
        console.error('[useTasks] clearTasksByTag ERROR', error)
        // Note: alert() may also be blocked - log instead
        console.error('[useTasks] clearTasksByTag: Please fix this error:', (error as Error).message)
      }
      return
    }
    
    // NOTE: Browser dialogs (confirm/prompt/alert) are being blocked by browser/extension
    // Proceeding without confirmation - TODO: implement custom React modal for confirmation
    console.log('[useTasks] clearTasksByTag: proceeding without confirmation (dialogs blocked)', { taskCount: tagTasks.length })

    try {
      console.log('[useTasks] clearTasksByTag: starting batch clear')
      
      // Use batch API if available
      if ('batchClearTag' in api) {
        await api.batchClearTag(
          currentBoardId,
          tag,
          tagTasks.map(t => t.id)
        )
      } else {
        // Fallback to old method for public mode
        await withBulkOperation(async () => {
          for (const task of tagTasks) {
            const existingTags = task.tag?.split(' ') || []
            const updatedTags = existingTags.filter(tg => tg !== tag)
            const tagValue = updatedTags.length > 0 ? updatedTags.join(' ') : null
            console.log('[useTasks] clearTasksByTag: patching task', { taskId: task.id, oldTags: existingTags, newTags: updatedTags })
            await api.patchTask(task.id, { tag: tagValue }, currentBoardId, true)
          }
          
          console.log('[useTasks] clearTasksByTag: deleting tag from board', { tag, currentBoardId })
          await api.deleteTag(tag, currentBoardId)
        }, userType, userId)
      }
      
      console.log('[useTasks] clearTasksByTag: calling reload')
      await reload()
      
      console.log('[useTasks] clearTasksByTag END')
    } catch (error) {
      console.error('[useTasks] clearTasksByTag ERROR', error)
      alert((error as Error).message || 'Failed to remove tag from tasks')
    }
  }

  async function clearRemainingTasks(tasksToDelete: Task[]) {
    if (!confirm('Clear all remaining tasks?')) return
    
    try {
      for (const task of tasksToDelete) {
        await api.deleteTask(task.id, currentBoardId)
      }
      await reload()
    } catch (error) {
      alert((error as Error).message || 'Failed to clear remaining tasks')
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
    console.log('[useTasks] moveTasksToBoard START', { targetBoardId, ids, currentBoardId })
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
    
    console.log('[useTasks] moveTasksToBoard: source boards', { sourceBoardIds: Array.from(sourceBoardIds) })

    try {
      // Use batch API if available and all tasks are from the same board
      if ('batchMoveTasks' in api && sourceBoardIds.size === 1) {
        const sourceBoardId = Array.from(sourceBoardIds)[0]
        console.log('[useTasks] moveTasksToBoard: using batch API')
        await api.batchMoveTasks(sourceBoardId, targetBoardId, ids)
      } else {
        // Fallback: collect tasks to move
        const tasksToMove: { id: string; title: string; tag?: string; boardId: string; createdAt: string }[] = []
        for (const b of boards.boards) {
          for (const t of b.tasks || []) {
            if (ids.includes(t.id)) {
              tasksToMove.push({ id: t.id, title: t.title, tag: t.tag || undefined, boardId: b.id, createdAt: t.createdAt })
            }
          }
        }
        console.log('[useTasks] moveTasksToBoard: using old method, found tasks', { count: tasksToMove.length })
        
        await withBulkOperation(async () => {
          for (const t of tasksToMove) {
            // Preserve original task ID and createdAt timestamp when moving
            await api.createTask({ id: t.id, title: t.title, tag: t.tag, createdAt: t.createdAt }, targetBoardId, true)
            await api.deleteTask(t.id, t.boardId, true)
          }
        }, userType, userId)
      }
      
      // Switch to the target board and reload it
      console.log('[useTasks] moveTasksToBoard: switching to target board', { targetBoardId })
      setCurrentBoardId(targetBoardId)
      const bf = await api.getBoards()
      setBoards(bf)
      const { tasks: boardTasks } = extractBoardTasks(bf, targetBoardId)
      setTasks(boardTasks)
      console.log('[useTasks] moveTasksToBoard END')
    } catch (error) {
      console.error('[useTasks] moveTasksToBoard ERROR', error)
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
    completeTask,
    deleteTask,
    addTagToTask,
    updateTaskTags,
    bulkUpdateTaskTags,
    clearTasksByTag,
    clearRemainingTasks,
    
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
