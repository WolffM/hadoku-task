/**
 * Tag parsing and filtering utilities
 */

import type { Task } from '../types'

/**
 * Split a tag string into an array of individual tags
 */
export function splitTags(tagString: string | null | undefined): string[] {
  return tagString?.split(' ').filter(Boolean) || []
}

/**
 * Format tags for display with # prefix (e.g., "#work #urgent")
 */
export function formatTagsForDisplay(tagString: string | null | undefined): string {
  return splitTags(tagString)
    .sort()
    .map(tag => `#${tag}`)
    .join(' ')
}

/**
 * Format error for logging
 */
export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Extract normalized tags from a tags string (e.g., "#friend #soon")
 * Returns tags as space-separated string or undefined if no tags
 */
function extractTags(tagsText: string): string | undefined {
  const normalizeTag = (tag: string) => tag.trim().replace(/\s+/g, '-')
  const tags =
    tagsText
      .match(/#[^\s#]+/g)
      ?.map(tag => normalizeTag(tag.slice(1)))
      .filter(Boolean) || []
  return tags.length ? tags.join(' ') : undefined
}

/**
 * Parse task input and extract title and tags
 */
export function parseTaskInput(input: string): { title: string; tag?: string } {
  // Trim input
  input = input.trim()

  // Handle quoted tasks with tags: "New task" #friend #soon
  const quotedMatch = input.match(/^["']([^"']+)["']\s*(.*)$/)
  if (quotedMatch) {
    return { title: quotedMatch[1].trim(), tag: extractTags(quotedMatch[2]) }
  }

  // Handle unquoted tasks with tags: New task #friend #soon
  const tagMatch = input.match(/^(.+?)\s+(#.+)$/)
  if (tagMatch) {
    return { title: tagMatch[1].trim(), tag: extractTags(tagMatch[2]) }
  }

  // Plain task without tags - trim title
  return { title: input.trim() }
}

/**
 * Get the top N tags from a list of tasks
 */
export function getTopTags(tasks: Task[], limit = 6, extraTags: string[] = []): string[] {
  const taskTags = tasks.flatMap(t => splitTags(t.tag))
  const tagCounts: { [tag: string]: number } = {}
  taskTags.forEach(tag => (tagCounts[tag] = (tagCounts[tag] || 0) + 1))
  // Include extraTags with zero count so they appear if there are no task occurrences
  extraTags.filter(Boolean).forEach(tag => {
    if (!tagCounts[tag]) tagCounts[tag] = 0
  })
  return Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag)
}

/**
 * Get all tasks that have a specific tag
 */
export function getTasksByTag(tasks: Task[], tag: string): Task[] {
  return tasks.filter(t => splitTags(t.tag).includes(tag))
}

/**
 * Get tasks that don't have any of the excluded tags
 */
export function getRemainingTasks(
  tasks: Task[],
  excludeTags: string[],
  filters?: string[] | undefined
): Task[] {
  const hasFilters = Array.isArray(filters) && filters.length > 0
  return tasks.filter(t => {
    const taskTags = splitTags(t.tag)
    if (!hasFilters || !filters) {
      // No filter: exclude tasks that have any of the top tags
      return !excludeTags.some(tag => taskTags.includes(tag))
    } else {
      // Filter active: only show tasks that match any selected filter and don't have top tags
      const matchesFilter = filters.some(f => taskTags.includes(f))
      return matchesFilter && !excludeTags.some(tag => taskTags.includes(tag))
    }
  })
}

/**
 * Get all unique tags from tasks
 */
export function getAllTags(tasks: Task[]): string[] {
  return Array.from(new Set(tasks.flatMap(t => splitTags(t.tag))))
}
