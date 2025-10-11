/**
 * Hook for managing drag and drop functionality
 */

import React, { useState } from 'react'
import type { Task } from '@hadoku/task/api/types'

interface UseDragAndDropProps {
  tasks: Task[]
  onTaskUpdate: (taskId: string, updates: { tag: string }) => Promise<void>
}

export function useDragAndDrop({ tasks, onTaskUpdate }: UseDragAndDropProps) {
  const [dragOverTag, setDragOverTag] = useState<string | null>(null)
  const [dragOverFilter, setDragOverFilter] = useState<string | null>(null)

  function onDragStart(e: React.DragEvent, taskId: string) {
    e.dataTransfer.setData('text/plain', taskId)
    e.dataTransfer.effectAllowed = 'copy'
  }

  function onDragOver(e: React.DragEvent, targetTag: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOverTag(targetTag)
  }

  function onDragLeave(e: React.DragEvent) {
    // Only clear if we're actually leaving the drop zone
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTag(null)
    }
  }

  async function onDrop(e: React.DragEvent, targetTag: string) {
    e.preventDefault()
    setDragOverTag(null)
    
    const taskId = e.dataTransfer.getData('text/plain')
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    
    const existingTags = task.tag?.split(' ') || []
    if (existingTags.includes(targetTag)) {
      console.log(`Task already has tag: ${targetTag}`)
      return // Tag already exists
    }
    
    const updatedTags = [...existingTags, targetTag].join(' ')
    console.log(`Adding tag "${targetTag}" to task "${task.title}". New tags: "${updatedTags}"`)
    
    try {
      await onTaskUpdate(taskId, { tag: updatedTags })
    } catch (error) {
      console.error('Failed to add tag:', error)
      alert((error as Error).message || 'Failed to add tag')
    }
  }

  function onFilterDragOver(e: React.DragEvent, filterTag: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOverFilter(filterTag)
  }

  function onFilterDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverFilter(null)
    }
  }

  async function onFilterDrop(e: React.DragEvent, filterTag: string) {
    e.preventDefault()
    setDragOverFilter(null)
    
    const taskId = e.dataTransfer.getData('text/plain')
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    
    const existingTags = task.tag?.split(' ') || []
    if (existingTags.includes(filterTag)) {
      console.log(`Task already has tag: ${filterTag}`)
      return // Tag already exists
    }
    
    const updatedTags = [...existingTags, filterTag].join(' ')
    console.log(`Adding tag "${filterTag}" to task "${task.title}" via filter drop. New tags: "${updatedTags}"`)
    
    try {
      await onTaskUpdate(taskId, { tag: updatedTags })
    } catch (error) {
      console.error('Failed to add tag via filter drop:', error)
      alert((error as Error).message || 'Failed to add tag')
    }
  }

  return {
    dragOverTag,
    dragOverFilter,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onFilterDragOver,
    onFilterDragLeave,
    onFilterDrop
  }
}
