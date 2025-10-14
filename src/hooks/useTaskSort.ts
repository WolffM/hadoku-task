/**
 * Hook for managing task sorting
 */

import { useState } from 'react'
import type { Task } from '../domain/types'

export type SortDirection = 'asc' | 'desc'

export function useTaskSort() {
  const [sortDirections, setSortDirections] = useState<{ [key: string]: SortDirection }>({})

  function toggleSort(sectionKey: string) {
    setSortDirections(prev => {
      const current = prev[sectionKey] || 'desc'
      const next: SortDirection = current === 'desc' ? 'asc' : 'desc'
      
      return { ...prev, [sectionKey]: next }
    })
  }

  function sortTasksByAge(tasks: Task[], direction: SortDirection): Task[] {
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
    return '↓' // newest first (default)
  }

  function getSortTitle(direction: SortDirection): string {
    if (direction === 'asc') return 'Sorted by age (oldest first) - click to sort newest first'
    return 'Sorted by age (newest first) - click to sort oldest first'
  }

  return {
    sortDirections,
    toggleSort,
    sortTasksByAge,
    getSortIcon,
    getSortTitle
  }
}
