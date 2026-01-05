/**
 * Factory functions for creating default data structures
 * Centralized to avoid duplication across storage implementations
 */

import type { StatsFile, TasksFile, BoardsFile } from '../types'

/**
 * Create a default empty stats file
 */
export function createDefaultStats(): StatsFile {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    counters: { created: 0, completed: 0, edited: 0, deleted: 0 },
    timeline: [],
    tasks: {}
  }
}

/**
 * Create a default empty tasks file
 */
export function createDefaultTasks(): TasksFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    tasks: []
  }
}

/**
 * Create a default boards file with a main board
 */
export function createDefaultBoards(): BoardsFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    boards: [
      {
        id: 'main',
        name: 'Main',
        tasks: [],
        tags: []
      }
    ]
  }
}
