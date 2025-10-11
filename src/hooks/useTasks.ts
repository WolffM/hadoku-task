/**
 * Hook for managing task operations
 */

import { useState } from 'react'
import { createApi } from '../lib/api'
import type { Task, TasksFile } from '@hadoku/task/api/types'
import { parseTaskInput } from '../lib/tagUtils'

interface UseTasksProps {
  userType: 'public' | 'friend' | 'admin'
  isPublic: boolean
}

export function useTasks({ userType, isPublic }: UseTasksProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [pendingOperations, setPendingOperations] = useState<Set<string>>(new Set())
  const api = createApi(userType)

  async function initialLoad() {
    // Public mode now uses localStorage (no server calls)
    // Admin/friend modes load from server
    await reload()
  }

  async function reload() {
    const tf: TasksFile = await api.getTasks()
    // Only show Active tasks in the UI
    setTasks((tf.tasks || []).filter(t => t.state === 'Active'))
  }

  function broadcastTasksUpdated() {
    try {
      const bc = new BroadcastChannel('tasks')
      bc.postMessage({ type: 'tasks-updated' })
      bc.close()
    } catch (error) {
      console.warn('Failed to broadcast task update:', error)
    }
  }

  async function addTask(input: string) {
    input = input.trim()
    if (!input) return
    
    try {
      const parsed = parseTaskInput(input)
      await api.createTask(parsed)
      await reload()
      broadcastTasksUpdated()
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
      await api.completeTask(taskId)
      await reload()
      broadcastTasksUpdated()
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
    const operationKey = `delete-${taskId}`
    
    // Prevent duplicate requests
    if (pendingOperations.has(operationKey)) {
      return
    }
    
    // Add to pending operations
    setPendingOperations(prev => new Set([...prev, operationKey]))
    
    try {
      await api.deleteTask(taskId)
      await reload()
      broadcastTasksUpdated()
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
    
    // Normalize tag: convert spaces to hyphens
    const normalizedTag = newTag.trim().replace(/\s+/g, '-')
    
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    
    const existingTags = task.tag?.split(' ') || []
    if (existingTags.includes(normalizedTag)) return // Tag already exists
    
    const updatedTags = [...existingTags, normalizedTag].join(' ')
    
    try {
      await api.patchTask(taskId, { tag: updatedTags })
      await reload()
      broadcastTasksUpdated()
    } catch (error) {
      alert((error as Error).message || 'Failed to add tag')
    }
  }

  async function updateTaskTags(taskId: string, updates: { tag: string }) {
    try {
      await api.patchTask(taskId, updates)
      await reload()
      broadcastTasksUpdated()
    } catch (error) {
      throw error
    }
  }

  async function clearTasksByTag(tag: string) {
    if (!confirm(`Clear all tasks with #${tag} tag?`)) return
    
    try {
      const tagTasks = tasks.filter(t => t.tag?.split(' ').includes(tag))
      for (const task of tagTasks) {
        await api.deleteTask(task.id)
      }
      await reload()
      broadcastTasksUpdated()
    } catch (error) {
      alert((error as Error).message || 'Failed to clear tagged tasks')
    }
  }

  async function clearRemainingTasks(tasksToDelete: Task[]) {
    if (!confirm('Clear all remaining tasks?')) return
    
    try {
      for (const task of tasksToDelete) {
        await api.deleteTask(task.id)
      }
      await reload()
      broadcastTasksUpdated()
    } catch (error) {
      alert((error as Error).message || 'Failed to clear remaining tasks')
    }
  }

  return {
    tasks,
    pendingOperations,
    initialLoad,
    reload,
    addTask,
    completeTask,
    deleteTask,
    addTagToTask,
    updateTaskTags,
    clearTasksByTag,
    clearRemainingTasks
  }
}
