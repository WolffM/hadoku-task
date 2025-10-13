/**
 * Extracts task IDs from a drag/drop dataTransfer object.
 * Tries custom format first, falls back to plain text.
 * 
 * @param dataTransfer - The DataTransfer object from a drag/drop event
 * @returns Array of task IDs (empty array if none found)
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
