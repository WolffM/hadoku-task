/**
 * MCP tool definitions for the task service.
 *
 * Transport-agnostic: each tool is a name + description + JSON-Schema + handler
 * that operates on the shared TaskHandlers via an injected storage/auth context.
 * The stateless Streamable-HTTP handler (./handler.ts) wraps these; a different
 * transport could reuse them unchanged.
 */

import { TaskHandlers } from '@wolffm/task/api'
import type {
  TaskStorage,
  AuthContext,
  Task,
  CreateTaskInput,
  UpdateTaskInput
} from '@wolffm/task/api'

export interface ToolCtx {
  storage: TaskStorage
  auth: AuthContext
  defaultBoard: string
}

export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined

/** A task's calendar day: explicit `date`, else the UTC day of startTime (ISO is UTC). */
const dayOf = (t: Task): string | null => t.date ?? (t.startTime ? t.startTime.slice(0, 10) : null)

const tagsOf = (t: Task): string[] => (t.tag ? t.tag.split(' ').filter(Boolean) : [])

const requireId = (args: Record<string, unknown>): string => {
  const id = str(args.id)
  if (!id) throw new Error('`id` is required')
  return id
}

const boardOf = (args: Record<string, unknown>, ctx: ToolCtx): string =>
  str(args.board) ?? ctx.defaultBoard

async function findTask(ctx: ToolCtx, board: string, id: string): Promise<Task | undefined> {
  const tasks = await TaskHandlers.getBoardTasks(ctx.storage, ctx.auth, board)
  return tasks.find(t => t.id === id)
}

// Shared JSON-Schema fragments
const boardProp = {
  board: { type: 'string', description: 'Board id. Defaults to "main".' }
}
const scheduleProps = {
  date: {
    type: 'string',
    description: 'Calendar day "YYYY-MM-DD" for an all-day task (no specific time).'
  },
  startTime: {
    type: 'string',
    description: 'ISO 8601 start for a timed task, e.g. 2026-06-10T17:00:00.000Z'
  },
  endTime: { type: 'string', description: 'ISO 8601 end for a timed task.' }
}

export const TOOLS: ToolDef[] = [
  {
    name: 'list_tasks',
    description:
      'List active tasks on a board. Optionally filter to a single calendar day (date, "YYYY-MM-DD") and/or a tag.',
    inputSchema: {
      type: 'object',
      properties: {
        ...boardProp,
        date: { type: 'string', description: 'Only tasks on this day, "YYYY-MM-DD".' },
        tag: { type: 'string', description: 'Only tasks carrying this tag.' }
      }
    },
    handler: async (args, ctx) => {
      const board = boardOf(args, ctx)
      let tasks = await TaskHandlers.getBoardTasks(ctx.storage, ctx.auth, board)
      const date = str(args.date)
      if (date) tasks = tasks.filter(t => dayOf(t) === date)
      const tag = str(args.tag)
      if (tag) tasks = tasks.filter(t => tagsOf(t).includes(tag))
      return { board, count: tasks.length, tasks }
    }
  },
  {
    name: 'get_task',
    description: 'Get a single task by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, ...boardProp },
      required: ['id']
    },
    handler: async (args, ctx) => {
      const board = boardOf(args, ctx)
      const task = await findTask(ctx, board, requireId(args))
      if (!task) throw new Error(`Task ${str(args.id)} not found on board ${board}`)
      return task
    }
  },
  {
    name: 'create_task',
    description:
      'Create a task. For a timed calendar event pass startTime+endTime; for an all-day task pass date; omit all three for an unscheduled board task. `tag` is space-separated; `metadata` is arbitrary JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        notes: { type: 'string', description: 'Markdown body / plan for the task.' },
        tag: { type: 'string', description: 'Space-separated tags, e.g. "work urgent".' },
        ...scheduleProps,
        metadata: { type: 'object', description: 'Arbitrary provider/detail JSON.' },
        ...boardProp
      },
      required: ['title']
    },
    handler: async (args, ctx) => {
      const title = str(args.title)
      if (!title) throw new Error('`title` is required')
      const board = boardOf(args, ctx)
      const input: CreateTaskInput = {
        title,
        notes: str(args.notes) ?? null,
        tag: str(args.tag),
        date: str(args.date) ?? null,
        startTime: str(args.startTime) ?? null,
        endTime: str(args.endTime) ?? null,
        metadata: obj(args.metadata) ?? null
      }
      const { id } = await TaskHandlers.createTask(ctx.storage, ctx.auth, input, board)
      return findTask(ctx, board, id)
    }
  },
  {
    name: 'update_task',
    description: 'Update fields of a task. Only the fields you pass change.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        notes: { type: 'string', description: 'Markdown body / plan. Pass "" to clear.' },
        tag: { type: 'string' },
        ...scheduleProps,
        metadata: { type: 'object' },
        ...boardProp
      },
      required: ['id']
    },
    handler: async (args, ctx) => {
      const id = requireId(args)
      const board = boardOf(args, ctx)
      const input: UpdateTaskInput = {}
      if (args.title !== undefined) input.title = str(args.title)
      if (args.notes !== undefined) input.notes = str(args.notes) ?? null
      if (args.tag !== undefined) input.tag = str(args.tag)
      if (args.date !== undefined) input.date = str(args.date) ?? null
      if (args.startTime !== undefined) input.startTime = str(args.startTime) ?? null
      if (args.endTime !== undefined) input.endTime = str(args.endTime) ?? null
      if (args.metadata !== undefined) input.metadata = obj(args.metadata) ?? null
      await TaskHandlers.updateTask(ctx.storage, ctx.auth, id, input, board)
      return findTask(ctx, board, id)
    }
  },
  {
    name: 'set_task_notes',
    description:
      "Set (replace) a task's notes — the markdown body / plan. Dedicated tool so a long plan doesn't round-trip the whole task. Pass an empty string to clear.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        notes: { type: 'string', description: 'The full markdown body. Replaces any existing notes.' },
        ...boardProp
      },
      required: ['id', 'notes']
    },
    handler: async (args, ctx) => {
      const id = requireId(args)
      const board = boardOf(args, ctx)
      const notes = str(args.notes) ?? ''
      await TaskHandlers.updateTask(ctx.storage, ctx.auth, id, { notes }, board)
      return findTask(ctx, board, id)
    }
  },
  {
    name: 'schedule_task',
    description:
      'Put an existing task on the calendar: pass startTime+endTime for a timed slot, or date for all-day. Pass clear:true to unschedule it (back to a board-only task).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        ...scheduleProps,
        clear: { type: 'boolean', description: 'Remove the schedule, leaving a board-only task.' },
        ...boardProp
      },
      required: ['id']
    },
    handler: async (args, ctx) => {
      const id = requireId(args)
      const board = boardOf(args, ctx)
      const input: UpdateTaskInput =
        args.clear === true
          ? { date: null, startTime: null, endTime: null }
          : {
              date: str(args.date) ?? null,
              startTime: str(args.startTime) ?? null,
              endTime: str(args.endTime) ?? null
            }
      await TaskHandlers.updateTask(ctx.storage, ctx.auth, id, input, board)
      return findTask(ctx, board, id)
    }
  },
  {
    name: 'complete_task',
    description: 'Mark a task complete (removes it from the active list).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, ...boardProp },
      required: ['id']
    },
    handler: async (args, ctx) => {
      const id = requireId(args)
      const board = boardOf(args, ctx)
      return TaskHandlers.completeTask(ctx.storage, ctx.auth, id, board)
    }
  },
  {
    name: 'delete_task',
    description: 'Delete a task.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, ...boardProp },
      required: ['id']
    },
    handler: async (args, ctx) => {
      const id = requireId(args)
      const board = boardOf(args, ctx)
      return TaskHandlers.deleteTask(ctx.storage, ctx.auth, id, board)
    }
  },
  {
    name: 'list_boards',
    description: 'List the available boards.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const boards = await TaskHandlers.getBoards(ctx.storage, ctx.auth)
      return { boards: boards.boards.map(b => ({ id: b.id, name: b.name, tags: b.tags })) }
    }
  }
]

const TOOL_BY_NAME = new Map(TOOLS.map(t => [t.name, t]))

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolCtx
): Promise<unknown> {
  const tool = TOOL_BY_NAME.get(name)
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  return tool.handler(args ?? {}, ctx)
}
