/**
 * Extracts task IDs from a drag/drop dataTransfer object.
 * Tries custom format first, falls back to plain text.
 */
export function getTaskIdsFromDragEvent(dataTransfer: DataTransfer): string[] {
  let ids: string[] = []
  
  try {
    const raw = dataTransfer.getData('application/x-hadoku-task-ids')
    if (raw) ids = JSON.parse(raw)
  } catch {}
  
  if (ids.length === 0) {
    const t = dataTransfer.getData('text/plain')
    if (t) ids = [t]
  }
  
  return ids
}
