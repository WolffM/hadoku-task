/**
 * UI formatting utilities
 */

/**
 * Format a timestamp as a human-readable age string
 */
export function formatAge(createdAt: string): string {
  const now = new Date()
  const created = new Date(createdAt)
  // Calculate diff using UTC to avoid timezone issues
  const diffMs = now.getTime() - created.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffSec < 60) return `${diffSec}s ago`
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  return `${diffDay}d ago`
}
