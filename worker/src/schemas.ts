/**
 * Zod schemas for OpenAPI spec generation
 * These define the request/response shapes for all Task API endpoints
 */

import { z } from '@hono/zod-openapi'
import {
  SimpleErrorResponseSchema,
  ThrottleErrorResponseSchema as SharedThrottleErrorResponseSchema,
  ValidationErrorResponseSchema,
  TaskApiHealthResponseSchema
} from '@wolffm/worker-utils'

// Re-export shared schemas for convenience
export { ValidationErrorResponseSchema }
export const ErrorResponseSchema = SimpleErrorResponseSchema
export const ThrottleErrorResponseSchema = SharedThrottleErrorResponseSchema
export const HealthResponseSchema = TaskApiHealthResponseSchema

// ============================================================================
// Base Entity Schemas
// ============================================================================

export const TaskSchema = z
  .object({
    id: z.string().openapi({ example: '01HXYZ123ABC' }),
    title: z.string().openapi({ example: 'Complete project documentation' }),
    tag: z.string().nullable().optional().openapi({ example: 'work' }),
    state: z.enum(['Active', 'Deleted', 'Completed']).openapi({ example: 'Active' }),
    createdAt: z.string().openapi({ example: '2024-01-15T10:30:00.000Z' }),
    updatedAt: z.string().nullable().optional().openapi({ example: '2024-01-15T11:00:00.000Z' }),
    closedAt: z.string().nullable().optional().openapi({ example: null })
  })
  .openapi('Task')

export const StatsCountersSchema = z
  .object({
    created: z.number().openapi({ example: 42 }),
    completed: z.number().openapi({ example: 35 }),
    edited: z.number().openapi({ example: 15 }),
    deleted: z.number().openapi({ example: 3 })
  })
  .openapi('StatsCounters')

export const TimelineEventSchema = z
  .object({
    t: z.string().openapi({ example: '2024-01-15T10:30:00.000Z' }),
    event: z.enum(['created', 'completed', 'edited', 'deleted']).openapi({ example: 'created' }),
    id: z.string().optional().openapi({ example: '01HXYZ123ABC' })
  })
  .openapi('TimelineEvent')

export const StatsSchema = z
  .object({
    version: z.literal(2).openapi({ example: 2 }),
    updatedAt: z.string().openapi({ example: '2024-01-15T10:30:00.000Z' }),
    counters: StatsCountersSchema,
    timeline: z.array(TimelineEventSchema),
    tasks: z.record(z.string(), TaskSchema)
  })
  .openapi('Stats')

export const BoardSchema = z
  .object({
    id: z.string().openapi({ example: 'main' }),
    name: z.string().openapi({ example: 'Main Board' }),
    tasks: z.array(TaskSchema),
    tags: z.array(z.string()).openapi({ example: ['work', 'personal', 'urgent'] }),
    stats: StatsSchema.optional()
  })
  .openapi('Board')

export const UserPreferencesSchema = z
  .object({
    theme: z.string().optional().openapi({ example: 'dark' }),
    buttons: z
      .record(z.string(), z.boolean())
      .optional()
      .openapi({ example: { complete: true, delete: false } }),
    experimentalFlags: z
      .record(z.string(), z.boolean())
      .optional()
      .openapi({ example: { newLayout: true } }),
    layout: z.record(z.string(), z.unknown()).optional(),
    lastUpdated: z.string().optional().openapi({ example: '2024-01-15T10:30:00.000Z' })
  })
  .openapi('UserPreferences')

// ============================================================================
// Task Endpoint Schemas
// ============================================================================

// GET /tasks
export const GetTasksResponseSchema = z
  .object({
    tasks: z.array(TaskSchema)
  })
  .openapi('GetTasksResponse')

// POST / (create task)
export const CreateTaskInputSchema = z
  .object({
    id: z.string().min(1).openapi({ example: '01HXYZ123ABC' }),
    title: z.string().min(1).openapi({ example: 'New task' }),
    tag: z.string().optional().openapi({ example: 'work' }),
    boardId: z.string().optional().openapi({ example: 'main' }),
    createdAt: z.string().optional().openapi({ example: '2024-01-15T10:30:00.000Z' }),
    startTime: z.string().nullable().optional().openapi({ example: '2024-01-15T09:00:00.000Z' }),
    endTime: z.string().nullable().optional().openapi({ example: '2024-01-15T10:00:00.000Z' })
  })
  .passthrough()
  .openapi('CreateTaskInput')

export const CreateTaskResponseSchema = z
  .object({
    ok: z.literal(true),
    id: z.string().openapi({ example: '01HXYZ123ABC' })
  })
  .openapi('CreateTaskResponse')

// PATCH /:id (update task)
export const UpdateTaskInputSchema = z
  .object({
    title: z.string().optional().openapi({ example: 'Updated title' }),
    tag: z.string().nullable().optional().openapi({ example: 'urgent' }),
    boardId: z.string().optional().openapi({ example: 'main' }),
    startTime: z.string().nullable().optional().openapi({ example: '2024-01-15T09:00:00.000Z' }),
    endTime: z.string().nullable().optional().openapi({ example: '2024-01-15T10:00:00.000Z' })
  })
  .passthrough()
  .openapi('UpdateTaskInput')

export const UpdateTaskResponseSchema = z
  .object({
    ok: z.literal(true),
    message: z.string().openapi({ example: 'Task 01HXYZ123ABC updated' })
  })
  .openapi('UpdateTaskResponse')

// POST /:id/complete
export const CompleteTaskResponseSchema = z
  .object({
    ok: z.literal(true),
    message: z.string().openapi({ example: 'Task 01HXYZ123ABC completed' })
  })
  .openapi('CompleteTaskResponse')

// DELETE /:id
export const DeleteTaskResponseSchema = z
  .object({
    ok: z.literal(true),
    message: z.string().openapi({ example: 'Task 01HXYZ123ABC deleted' })
  })
  .openapi('DeleteTaskResponse')

// GET /stats
export const GetStatsResponseSchema = StatsSchema.openapi('GetStatsResponse')

// ============================================================================
// Board Endpoint Schemas
// ============================================================================

// GET /boards
export const GetBoardsResponseSchema = z
  .object({
    boards: z.array(
      z.object({
        id: z.string(),
        name: z.string()
      })
    ),
    userType: z.string().openapi({ example: 'admin' })
  })
  .openapi('GetBoardsResponse')

// POST /boards
export const CreateBoardInputSchema = z
  .object({
    id: z.string().min(1).openapi({ example: 'work-board' }),
    name: z.string().min(1).openapi({ example: 'Work Board' })
  })
  .openapi('CreateBoardInput')

export const CreateBoardResponseSchema = z
  .object({
    ok: z.literal(true),
    board: z.object({
      id: z.string(),
      name: z.string(),
      tasks: z.array(TaskSchema),
      tags: z.array(z.string())
    })
  })
  .openapi('CreateBoardResponse')

// DELETE /boards/:boardId
export const DeleteBoardResponseSchema = z
  .object({
    ok: z.literal(true),
    message: z.string().openapi({ example: 'Board work-board deleted' })
  })
  .openapi('DeleteBoardResponse')

// ============================================================================
// Tag Endpoint Schemas
// ============================================================================

// POST /tags
export const CreateTagInputSchema = z
  .object({
    boardId: z.string().min(1).openapi({ example: 'main' }),
    tag: z.string().min(1).openapi({ example: 'urgent' })
  })
  .openapi('CreateTagInput')

export const CreateTagResponseSchema = z
  .object({
    ok: z.literal(true),
    message: z.string().openapi({ example: 'Tag urgent added to board main' })
  })
  .openapi('CreateTagResponse')

// POST /tags/delete
export const DeleteTagInputSchema = z
  .object({
    boardId: z.string().min(1).openapi({ example: 'main' }),
    tag: z.string().min(1).openapi({ example: 'urgent' })
  })
  .openapi('DeleteTagInput')

export const DeleteTagResponseSchema = z
  .object({
    ok: z.literal(true),
    message: z.string().openapi({ example: 'Tag urgent removed from board main' })
  })
  .openapi('DeleteTagResponse')

// ============================================================================
// Batch Operation Schemas
// ============================================================================

// PATCH /batch-tag
export const BatchUpdateTagsInputSchema = z
  .object({
    boardId: z.string().optional().openapi({ example: 'main' }),
    updates: z.array(
      z.object({
        taskId: z.string().openapi({ example: '01HXYZ123ABC' }),
        tag: z.string().nullable().openapi({ example: 'urgent' })
      })
    )
  })
  .openapi('BatchUpdateTagsInput')

export const BatchUpdateTagsResponseSchema = z
  .object({
    ok: z.literal(true),
    message: z.string().openapi({ example: 'Updated 5 task(s) on board main' }),
    updated: z.number().openapi({ example: 5 })
  })
  .openapi('BatchUpdateTagsResponse')

// POST /batch-move
export const BatchMoveTasksInputSchema = z
  .object({
    sourceBoardId: z.string().min(1).openapi({ example: 'main' }),
    targetBoardId: z.string().min(1).openapi({ example: 'archive' }),
    taskIds: z.array(z.string()).openapi({ example: ['01HXYZ123ABC', '01HXYZ456DEF'] })
  })
  .openapi('BatchMoveTasksInput')

export const BatchMoveTasksResponseSchema = z
  .object({
    ok: z.literal(true),
    message: z.string().openapi({ example: 'Moved 2 task(s) from main to archive' }),
    moved: z.number().openapi({ example: 2 })
  })
  .openapi('BatchMoveTasksResponse')

// POST /batch-clear-tag
export const BatchClearTagInputSchema = z
  .object({
    boardId: z.string().min(1).openapi({ example: 'main' }),
    tag: z.string().min(1).openapi({ example: 'urgent' }),
    taskIds: z.array(z.string()).openapi({ example: ['01HXYZ123ABC', '01HXYZ456DEF'] })
  })
  .openapi('BatchClearTagInput')

export const BatchClearTagResponseSchema = z
  .object({
    ok: z.literal(true),
    message: z.string().openapi({ example: 'Cleared tag urgent from 2 task(s) on board main' }),
    cleared: z.number().openapi({ example: 2 })
  })
  .openapi('BatchClearTagResponse')

// ============================================================================
// Session Endpoint Schemas
// ============================================================================

// POST /session/handshake
export const SessionHandshakeInputSchema = z
  .object({
    newSessionId: z.string().min(1).openapi({ example: 'sess_abc123xyz' }),
    oldSessionId: z.string().nullable().optional().openapi({ example: 'sess_old456def' })
  })
  .openapi('SessionHandshakeInput')

export const SessionHandshakeResponseSchema = z
  .object({
    success: z.literal(true),
    sessionId: z.string().openapi({ example: 'sess_abc123xyz' }),
    migrated: z.boolean().openapi({ example: true }),
    preferences: UserPreferencesSchema.optional()
  })
  .openapi('SessionHandshakeResponse')

// ============================================================================
// Preferences Endpoint Schemas
// ============================================================================

// GET /preferences
export const GetPreferencesResponseSchema = UserPreferencesSchema

// PUT /preferences
export const UpdatePreferencesInputSchema = z
  .object({
    theme: z.string().optional(),
    buttons: z.record(z.string(), z.boolean()).optional(),
    experimentalFlags: z.record(z.string(), z.boolean()).optional(),
    layout: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough() // Allow additional fields like notifications, language, etc.
  .openapi('UpdatePreferencesInput')

export const UpdatePreferencesResponseSchema = z
  .object({
    ok: z.literal(true),
    message: z.string().openapi({ example: 'Preferences saved' }),
    preferences: UserPreferencesSchema
  })
  .openapi('UpdatePreferencesResponse')

// ============================================================================
// Admin Endpoint Schemas
// ============================================================================

// GET /admin/throttle/:sessionId
export const ThrottleStateSchema = z
  .object({
    requestCount: z.number().openapi({ example: 15 }),
    windowStart: z.number().openapi({ example: 1704067200000 }),
    violations: z.number().openapi({ example: 0 })
  })
  .openapi('ThrottleState')

export const IncidentSchema = z
  .object({
    timestamp: z.string().openapi({ example: '2024-01-15T10:30:00.000Z' }),
    type: z.string().openapi({ example: 'throttle_violation' }),
    sessionId: z.string().openapi({ example: 'sess_***abc' }),
    authKey: z.string().optional().openapi({ example: 'key_***xyz' }),
    userType: z.string().openapi({ example: 'public' }),
    details: z.record(z.string(), z.unknown()).optional()
  })
  .openapi('Incident')

export const GetThrottleStatusResponseSchema = z
  .object({
    sessionId: z.string().openapi({ example: 'sess_***abc' }),
    throttleState: ThrottleStateSchema.nullable(),
    blacklisted: z.boolean().openapi({ example: false }),
    incidents: z.array(IncidentSchema),
    incidentCount: z.number().openapi({ example: 0 })
  })
  .openapi('GetThrottleStatusResponse')

// GET /admin/sessions/:authKey
export const GetSessionsResponseSchema = z
  .object({
    authKey: z.string().openapi({ example: 'key_***xyz' }),
    sessionCount: z.number().optional().openapi({ example: 3 }),
    sessions: z.array(z.string()).openapi({ example: ['sess_***abc', 'sess_***def'] }),
    lastSessionId: z.string().nullable().openapi({ example: 'sess_***abc' }),
    suspicious: z.boolean().optional().openapi({ example: false }),
    suspiciousReasons: z.array(z.string()).optional().openapi({ example: [] })
  })
  .openapi('GetSessionsResponse')

// POST /admin/unblacklist/:sessionId
export const UnblacklistResponseSchema = z
  .object({
    success: z.literal(true),
    message: z.string().openapi({ example: 'Session sess_***abc unblacklisted' })
  })
  .openapi('UnblacklistResponse')

// ============================================================================
// Misc Endpoint Schemas
// ============================================================================

// POST /validate-key
export const ValidateKeyResponseSchema = z
  .object({
    valid: z.boolean().openapi({ example: true }),
    userType: z.string().openapi({ example: 'admin' })
  })
  .openapi('ValidateKeyResponse')
