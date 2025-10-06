/**
 * Stats Operations - Pure functions for updating stats
 */

import type { StatsFile, Task } from '../types.js'

/**
 * Record task creation in stats
 */
export function recordCreation(stats: StatsFile, task: Task, now: string): StatsFile {
  return {
    ...stats,
    counters: {
      ...stats.counters,
      created: stats.counters.created + 1
    },
    timeline: [
      ...stats.timeline,
      { t: now, event: 'create', id: task.id }
    ],
    tasks: {
      ...stats.tasks,
      [task.id]: {
        id: task.id,
        title: task.title,
        tag: task.tag,
        createdAt: now,
        updatedAt: null,
        closedAt: null,
        state: 'Active'
      }
    },
    updatedAt: now
  }
}

/**
 * Record task completion in stats
 */
export function recordCompletion(stats: StatsFile, task: Task, now: string): StatsFile {
  return {
    ...stats,
    counters: {
      ...stats.counters,
      completed: stats.counters.completed + 1
    },
    timeline: [
      ...stats.timeline,
      { t: now, event: 'completed', id: task.id }
    ],
    tasks: {
      ...stats.tasks,
      [task.id]: {
        id: task.id,
        title: task.title,
        tag: task.tag,
        state: 'Completed',
        createdAt: task.createdAt,
        updatedAt: now,
        closedAt: now
      }
    },
    updatedAt: now
  }
}

/**
 * Record task update in stats
 */
export function recordUpdate(stats: StatsFile, task: Task, now: string, isCompletion: boolean): StatsFile {
  const existing = stats.tasks[task.id] || {
    id: task.id,
    title: task.title,
    tag: task.tag,
    createdAt: task.createdAt,
    updatedAt: null,
    closedAt: null,
    state: 'Active'
  }

  return {
    ...stats,
    counters: {
      ...stats.counters,
      [isCompletion ? 'completed' : 'edited']: stats.counters[isCompletion ? 'completed' : 'edited'] + 1
    },
    timeline: [
      ...stats.timeline,
      { t: now, event: isCompletion ? 'complete' : 'edit', id: task.id }
    ],
    tasks: {
      ...stats.tasks,
      [task.id]: {
        ...existing,
        title: task.title,
        tag: task.tag,
        updatedAt: now,
        closedAt: isCompletion ? now : existing.closedAt,
        state: isCompletion ? 'completed' : existing.state
      }
    },
    updatedAt: now
  }
}

/**
 * Record task deletion in stats
 */
export function recordDeletion(stats: StatsFile, task: Task, now: string): StatsFile {
  return {
    ...stats,
    counters: {
      ...stats.counters,
      deleted: stats.counters.deleted + 1
    },
    timeline: [
      ...stats.timeline,
      { t: now, event: 'deleted', id: task.id }
    ],
    tasks: {
      ...stats.tasks,
      [task.id]: {
        id: task.id,
        title: task.title,
        tag: task.tag,
        state: 'Deleted',
        createdAt: task.createdAt,
        updatedAt: now,
        closedAt: now
      }
    },
    updatedAt: now
  }
}

/**
 * Clear all stats (public only)
 */
export function clearStats(now: string): StatsFile {
  return {
    version: 2,
    counters: { created: 0, completed: 0, edited: 0, deleted: 0 },
    timeline: [],
    tasks: {},
    updatedAt: now
  }
}
