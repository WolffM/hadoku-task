/**
 * Event Logging Service
 *
 * Handles all task event logging to D1 database.
 * Replaces the old stats system that stored everything in KV.
 */

export type TaskEventType = 'created' | 'completed' | 'edited' | 'deleted'

export interface TaskEvent {
  userKey: string
  boardId: string
  taskId: string
  eventType: TaskEventType
  metadata?: Record<string, unknown> // Optional: task title, old values, etc.
}

export interface EventStats {
  created: number
  completed: number
  edited: number
  deleted: number
}

/**
 * Log a task event to D1
 */
export async function logTaskEvent(db: D1Database, event: TaskEvent): Promise<void> {
  const metadata = event.metadata ? JSON.stringify(event.metadata) : null

  await db
    .prepare(
      `
    INSERT INTO task_events (user_key, board_id, task_id, event_type, metadata)
    VALUES (?, ?, ?, ?, ?)
  `
    )
    .bind(event.userKey, event.boardId, event.taskId, event.eventType, metadata)
    .run()
}

/**
 * Get event counts for a board (replaces old stats.counters)
 */
export async function getBoardStats(
  db: D1Database,
  userKey: string,
  boardId: string
): Promise<EventStats> {
  const result = await db
    .prepare(
      `
    SELECT
      event_type,
      COUNT(*) as count
    FROM task_events
    WHERE user_key = ? AND board_id = ?
    GROUP BY event_type
  `
    )
    .bind(userKey, boardId)
    .all()

  const stats: EventStats = {
    created: 0,
    completed: 0,
    edited: 0,
    deleted: 0
  }

  for (const row of result.results) {
    const eventType = row.event_type as TaskEventType
    stats[eventType] = row.count as number
  }

  return stats
}

/**
 * Get recent events for a board (replaces old stats.timeline)
 */
export async function getBoardTimeline(
  db: D1Database,
  userKey: string,
  boardId: string,
  limit = 100
): Promise<{ timestamp: string; event: string; id: string }[]> {
  const result = await db
    .prepare(
      `
    SELECT task_id, event_type, timestamp
    FROM task_events
    WHERE user_key = ? AND board_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `
    )
    .bind(userKey, boardId, limit)
    .all()

  interface D1Row {
    task_id: string
    event_type: string
    timestamp: string
  }

  return result.results.map(row => {
    const typedRow = row as unknown as D1Row
    return {
      timestamp: typedRow.timestamp,
      event: typedRow.event_type,
      id: typedRow.task_id
    }
  })
}

/**
 * Get task history (all events for a specific task)
 */
export async function getTaskHistory(
  db: D1Database,
  taskId: string
): Promise<{ timestamp: string; eventType: string; metadata?: unknown }[]> {
  const result = await db
    .prepare(
      `
    SELECT event_type, timestamp, metadata
    FROM task_events
    WHERE task_id = ?
    ORDER BY timestamp ASC
  `
    )
    .bind(taskId)
    .all()

  interface D1Row {
    event_type: string
    timestamp: string
    metadata?: string
  }

  return result.results.map(row => {
    const typedRow = row as unknown as D1Row
    return {
      timestamp: typedRow.timestamp,
      eventType: typedRow.event_type,
      metadata: typedRow.metadata ? JSON.parse(typedRow.metadata) : undefined
    }
  })
}

/**
 * Get all user stats across all boards
 */
export async function getUserStats(db: D1Database, userKey: string): Promise<EventStats> {
  const result = await db
    .prepare(
      `
    SELECT
      event_type,
      COUNT(*) as count
    FROM task_events
    WHERE user_key = ?
    GROUP BY event_type
  `
    )
    .bind(userKey)
    .all()

  const stats: EventStats = {
    created: 0,
    completed: 0,
    edited: 0,
    deleted: 0
  }

  for (const row of result.results) {
    const eventType = row.event_type as TaskEventType
    stats[eventType] = row.count as number
  }

  return stats
}

/**
 * Delete all events for a board (when board is deleted)
 */
export async function deleteBoardEvents(
  db: D1Database,
  userKey: string,
  boardId: string
): Promise<void> {
  await db
    .prepare(
      `
    DELETE FROM task_events
    WHERE user_key = ? AND board_id = ?
  `
    )
    .bind(userKey, boardId)
    .run()
}
