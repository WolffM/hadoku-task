/**
 * Layout configuration utilities
 */

export interface LayoutConfig {
  columns: number
  useTags: number
  maxPerColumn: number
}

/**
 * Get the layout configuration based on the number of tags
 */
export function getLayoutConfig(tagCount: number): LayoutConfig {
  if (tagCount === 2) return { columns: 2, useTags: 2, maxPerColumn: Infinity }
  if (tagCount === 3) return { columns: 3, useTags: 3, maxPerColumn: Infinity }
  if (tagCount >= 4 && tagCount <= 5) return { columns: 2, useTags: 4, maxPerColumn: 10 }
  return { columns: 3, useTags: 6, maxPerColumn: 10 } // 6+ tags
}
