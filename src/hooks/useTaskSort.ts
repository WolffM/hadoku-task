/**
 * Hook for managing task sorting
 */

import { useState } from 'react'
import type { Task } from '../lib/types'

export type SortDirection = 'asc' | 'desc' | null

export function useTaskSort() {
  const [sortDirections, setSortDirections] = useState<{ [key: string]: SortDirection }>({})

  function toggleSort(sectionKey: string) {
    setSortDirections(prev => {
      const current = prev[sectionKey] || null
      let next: SortDirection
      
      if (current === null) next = 'desc' // newest first
      else if (current === 'desc') next = 'asc' // oldest first
      else next = null // no sort
      
      return { ...prev, [sectionKey]: next }
    })
  }

  function sortTasksByAge(tasks: Task[], direction: SortDirection): Task[] {
    if (!direction) return tasks
    
    return [...tasks].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime()
      const dateB = new Date(b.createdAt).getTime()
      
      if (direction === 'asc') {
        return dateA - dateB // oldest first
      } else {
        return dateB - dateA // newest first
      }
    })
  }

  function getSortIcon(direction: SortDirection): string {
    if (direction === 'asc') return '↑' // oldest first
    if (direction === 'desc') return '↓' // newest first
    return '↕' // no sort / default
  }

  function getSortTitle(direction: SortDirection): string {
    if (direction === 'asc') return 'Sorted by age (oldest first) - click to sort newest first'
    if (direction === 'desc') return 'Sorted by age (newest first) - click to disable sorting'
    return 'Click to sort by age (newest first)'
  }

  return {
    sortDirections,
    toggleSort,
    sortTasksByAge,
    getSortIcon,
    getSortTitle
  }
}
