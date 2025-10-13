/**
 * Hook for managing task operations
 */

import { useState, useEffect } from 'react'
import { createApi } from '../lib/api'
import type { Task, TasksFile, BoardsFile } from '../lib/types'
import { parseTaskInput } from '../lib/tagUtils'

interface UseTasksProps {
  userType: string
  userId?: string
}

// Generate a unique session ID to identify this tab's broadcasts
export const SESSION_ID = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

// Helper to broadcast with delay to ensure localStorage propagation across tabs
function deferredBroadcast(sessionId: string, userType: string, userId?: string, delayMs: number = 50) {
  setTimeout(() => {
    try {
      const bc = new BroadcastChannel('tasks')
      bc.postMessage({ type: 'tasks-updated', sessionId, userType, userId })
      bc.close()
    } catch (err) {
      console.error('[useTasks] Broadcast failed:', err)
    }
  }, delayMs)
}

export function useTasks({ userType, userId }: UseTasksProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [pendingOperations, setPendingOperations] = useState<Set<string>>(new Set())
  const api = createApi(userType as 'public' | 'friend' | 'admin', userId || 'public')
  const [boards, setBoards] = useState<BoardsFile | null>(null)
  const [currentBoardId, setCurrentBoardId] = useState<string>('main')

  async function initialLoad() {
    console.log('[useTasks] initialLoad called')
    await reload()
  }

  async function reload() {
    console.log('[useTasks] reload called', { currentBoardId, stack: new Error().stack?.split('\n').slice(1, 4).join('\n') })
    const bf = await api.getBoards()
    setBoards(bf)
    const board = bf.boards.find(b => b.id === currentBoardId)
    if (board) {
      console.log('[useTasks] reload: found current board', { boardId: board.id, taskCount: board.tasks?.length || 0 })
      setTasks((board.tasks || []).filter((t: Task) => t.state === 'Active'))
    } else {
      console.log('[useTasks] reload: board not found', { currentBoardId })
      setTasks([])
    }
  }

  // Listen for broadcasted updates about tasks or boards
  useEffect(() => {
    console.log('[useTasks] Setting up BroadcastChannel listener', { currentBoardId })
    try {
      const bcListener = new BroadcastChannel('tasks')
      bcListener.onmessage = (e) => {
        const msg = e.data || {}
        console.log('[useTasks] BroadcastChannel message received', { msg, sessionId: SESSION_ID, currentBoardId })
        
        // Ignore messages from the same session to prevent infinite loops
        if (msg.sessionId === SESSION_ID) {
          console.log('[useTasks] Ignoring own broadcast message')
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
  }, [currentBoardId]) // Recreate listener when board changes to capture latest state

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
    const operationKey = `complete-${taskId}`
    
    // Prevent duplicate requests
    if (pendingOperations.has(operationKey)) {
      return
    }
    
    // Add to pending operations
    setPendingOperations(prev => new Set([...prev, operationKey]))
    
    try {
      await api.completeTask(taskId, currentBoardId)
      await reload()
    } catch (error) {
      // Only show error if it's not a 404 (task already processed)
      if (!(error as any)?.message?.includes('404')) {
        alert((error as Error).message || 'Failed to complete task')
      }
    } finally {
      // Remove from pending operations
      setPendingOperations(prev => {
        const newSet = new Set(prev)
        newSet.delete(operationKey)
        return newSet
      })
    }
  }

  async function deleteTask(taskId: string) {
    console.log('[useTasks] deleteTask START', { taskId, currentBoardId })
    const operationKey = `delete-${taskId}`
    
    // Prevent duplicate requests
    if (pendingOperations.has(operationKey)) {
      console.log('[useTasks] deleteTask: already pending, skipping', { operationKey })
      return
    }
    
    // Add to pending operations
    setPendingOperations(prev => new Set([...prev, operationKey]))
    
    try {
      console.log('[useTasks] deleteTask: calling api.deleteTask', { taskId, currentBoardId })
      await api.deleteTask(taskId, currentBoardId)
      console.log('[useTasks] deleteTask: calling reload')
      await reload()
      console.log('[useTasks] deleteTask END')
    } catch (error) {
      // Only show error if it's not a 404 (task already processed)
      if (!(error as any)?.message?.includes('404')) {
        alert((error as Error).message || 'Failed to delete task')
      }
    } finally {
      // Remove from pending operations
      setPendingOperations(prev => {
        const newSet = new Set(prev)
        newSet.delete(operationKey)
        return newSet
      })
    }
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
  
  // Helper for bulk tag updates - suppresses broadcasts and reloads, then does both once at the end
  async function bulkUpdateTaskTags(updates: Array<{ taskId: string, tag: string }>) {
    console.log('[useTasks] bulkUpdateTaskTags START', { count: updates.length })
    try {
      // Suppress broadcasts during bulk operation
      for (const { taskId, tag } of updates) {
        await api.patchTask(taskId, { tag }, currentBoardId, true)
      }
      
      // Manually broadcast after bulk operation completes
      console.log('[useTasks] bulkUpdateTaskTags: broadcasting bulk update with delay')
      deferredBroadcast(SESSION_ID, userType, userId)
      
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
      console.log('[useTasks] clearTasksByTag: starting to patch tasks')
      
      // Suppress individual broadcasts during bulk operation
      for (const task of tagTasks) {
        const existingTags = task.tag?.split(' ') || []
        const updatedTags = existingTags.filter(tg => tg !== tag)
        const tagValue = updatedTags.length > 0 ? updatedTags.join(' ') : null
        console.log('[useTasks] clearTasksByTag: patching task', { taskId: task.id, oldTags: existingTags, newTags: updatedTags })
        await api.patchTask(task.id, { tag: tagValue }, currentBoardId, true)
      }
      
      console.log('[useTasks] clearTasksByTag: deleting tag from board', { tag, currentBoardId })
      await api.deleteTag(tag, currentBoardId)
      
      // Manually broadcast after bulk operation completes
      console.log('[useTasks] clearTasksByTag: broadcasting bulk update with delay')
      deferredBroadcast(SESSION_ID, userType, userId)
      
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
    const board = bf.boards.find(b => b.id === boardId)
    if (board) {
      console.log('[useTasks] createBoard: switched to new board', { boardId, taskCount: board.tasks?.length || 0 })
      setTasks((board.tasks || []).filter((t: Task) => t.state === 'Active'))
    } else {
      console.log('[useTasks] createBoard: new board not found (should be empty)', { boardId })
      setTasks([])
    }
  }

  // Move multiple tasks to another board
  async function moveTasksToBoard(targetBoardId: string, ids: string[]) {
    console.log('[useTasks] moveTasksToBoard START', { targetBoardId, ids, currentBoardId })
    if (!boards) return
    const tasksToMove: { id: string; title: string; tag?: string; boardId: string }[] = []
    for (const b of boards.boards) {
      for (const t of b.tasks || []) {
        if (ids.includes(t.id)) {
          tasksToMove.push({ id: t.id, title: t.title, tag: t.tag || undefined, boardId: b.id })
        }
      }
    }
    console.log('[useTasks] moveTasksToBoard: found tasks to move', { count: tasksToMove.length })

    // Suppress individual broadcasts during bulk operation
    for (const t of tasksToMove) {
      await api.createTask({ title: t.title, tag: t.tag }, targetBoardId, true)
      await api.deleteTask(t.id, t.boardId, true)
    }
    
    // Manually broadcast after bulk operation completes
    console.log('[useTasks] moveTasksToBoard: broadcasting bulk update with delay')
    deferredBroadcast(SESSION_ID, userType, userId)
    
    // Switch to the target board and reload it
    console.log('[useTasks] moveTasksToBoard: switching to target board', { targetBoardId })
    setCurrentBoardId(targetBoardId)
    const bf = await api.getBoards()
    setBoards(bf)
    const targetBoard = bf.boards.find(b => b.id === targetBoardId)
    if (targetBoard) {
      console.log('[useTasks] moveTasksToBoard: loaded target board tasks', { count: targetBoard.tasks?.length || 0 })
      setTasks((targetBoard.tasks || []).filter((t: Task) => t.state === 'Active'))
    }
    console.log('[useTasks] moveTasksToBoard END')
  }

  async function deleteBoard(boardId: string) {
    await api.deleteBoard(boardId)
    // If we're deleting the current board, switch to main and load its tasks
    if (currentBoardId === boardId) {
      setCurrentBoardId('main')
      // Fetch boards and explicitly load main board's tasks
      const bf = await api.getBoards()
      setBoards(bf)
      const mainBoard = bf.boards.find(b => b.id === 'main')
      if (mainBoard) {
        console.log('[useTasks] deleteBoard: switched to main board', { taskCount: mainBoard.tasks?.length || 0 })
        setTasks((mainBoard.tasks || []).filter((t: Task) => t.state === 'Active'))
      } else {
        console.log('[useTasks] deleteBoard: main board not found')
        setTasks([])
      }
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
    const board = boards?.boards.find(b => b.id === boardId)
    if (board) {
      setTasks((board.tasks || []).filter((t: Task) => t.state === 'Active'))
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
