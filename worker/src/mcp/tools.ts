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
  UpdateTaskInput,
  Lane
} from '@wolffm/task/api'
import { assertHumanLaneWrite, getBoardConfig } from '../routes/board-automation'
import {
  claimTask,
  heartbeatClaim,
  setLane,
  releaseClaim,
  cancelClaim,
  getClaimHistory,
  getChanges,
  liveClaimedTaskIds
} from '../routes/board-claims'

/** A board reference resolved to its owner's data scope + the caller's access (§7). */
export interface ResolvedBoard {
  storage: TaskStorage
  auth: AuthContext
  /** The owner's slug for the board (differs from a shared handle the caller passed). */
  boardId: string
  /** The board owner's userId — the data scope for D1-direct claim writes (§4). */
  ownerId: string
  access: 'owner' | 'contributor' | 'readonly'
  /** 'standard' | 'automation' — selects lane enforcement (§5.2). */
  mode: string
  /** The board's lane set (empty on a standard board). */
  lanes: Lane[]
}

/** The D1 database, structurally typed (matches board-claims' D1Like). */
export type ToolDb = Parameters<typeof claimTask>[0]

export interface ToolCtx {
  /** Caller-scoped storage, for non-board-scoped tools (list_boards). */
  storage: TaskStorage
  /** Caller-scoped auth. */
  auth: AuthContext
  /** The caller's own userId — the scope for the change feed (§4.4). */
  callerId: string
  /** D1, for the D1-direct claim protocol (§4). */
  db: ToolDb
  defaultBoard: string
  /**
   * Resolve a board ref to the owner's scope + caller's access. Own boards
   * resolve to the caller with 'owner'; a shared handle resolves to the owner
   * with the granted level; a real handle with no share resolves to null.
   */
  resolve: (ref: string) => Promise<ResolvedBoard | null>
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

/**
 * Resolve the board arg through the sharing layer so a shared handle reaches the
 * owner's data (§7). Throws a clear error for an unknown/unshared board, and —
 * when `write` — for a readonly grantee, mirroring the HTTP routes' 404/403.
 */
async function resolveBoard(
  args: Record<string, unknown>,
  ctx: ToolCtx,
  opts: { write?: boolean } = {}
): Promise<ResolvedBoard> {
  const ref = boardOf(args, ctx)
  const r = await ctx.resolve(ref)
  if (!r) throw new Error(`Board ${ref} not found`)
  if (opts.write && r.access === 'readonly') {
    throw new Error(`Read-only access to board ${ref}`)
  }
  return r
}

async function findTask(r: ResolvedBoard, id: string): Promise<Task | undefined> {
  const tasks = await TaskHandlers.getBoardTasks(r.storage, r.auth, r.boardId)
  return tasks.find(t => t.id === id)
}

// Shared JSON-Schema fragments
const boardProp = {
  board: {
    type: 'string',
    description:
      'Board reference. Your own board: its id (defaults to "main"). A board shared with you: its `handle` from list_boards.'
  }
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
      'List active tasks on a board. Optionally filter to a single calendar day (date, "YYYY-MM-DD") and/or a tag. Paginated: pass `limit` (default 100, max 500) and `offset` to page a large board; the result carries `total` and `nextOffset` (null when exhausted).',
    inputSchema: {
      type: 'object',
      properties: {
        ...boardProp,
        date: { type: 'string', description: 'Only tasks on this day, "YYYY-MM-DD".' },
        tag: { type: 'string', description: 'Only tasks carrying this tag.' },
        limit: { type: 'number', description: 'Max tasks to return (default 100, max 500).' },
        offset: { type: 'number', description: 'Skip this many (for paging). Default 0.' }
      }
    },
    handler: async (args, ctx) => {
      const r = await resolveBoard(args, ctx)
      let tasks = await TaskHandlers.getBoardTasks(r.storage, r.auth, r.boardId)
      // getBoardTasks returns the board's VISIBLE set, which includes tasks
      // completed in the last 24h (they stay on screen struck through). This tool
      // promises active tasks, and an agent must never pick up work that is
      // already done — so filter to Active here rather than widening the promise.
      tasks = tasks.filter(t => t.state === 'Active')
      const date = str(args.date)
      if (date) tasks = tasks.filter(t => dayOf(t) === date)
      const tag = str(args.tag)
      if (tag) tasks = tasks.filter(t => tagsOf(t).includes(tag))
      const total = tasks.length
      const limit = Math.min(Math.max(1, typeof args.limit === 'number' ? args.limit : 100), 500)
      const offset = Math.max(0, typeof args.offset === 'number' ? args.offset : 0)
      const page = tasks.slice(offset, offset + limit)
      const nextOffset = offset + page.length < total ? offset + page.length : null
      return {
        board: boardOf(args, ctx),
        count: page.length,
        total,
        offset,
        limit,
        nextOffset,
        tasks: page
      }
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
      const r = await resolveBoard(args, ctx)
      const task = await findTask(r, requireId(args))
      if (!task) throw new Error(`Task ${str(args.id)} not found on board ${boardOf(args, ctx)}`)
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
      const r = await resolveBoard(args, ctx, { write: true })
      // Human path (§5.2): a new task on an automation board may only land in a user lane.
      if (r.mode === 'automation') assertHumanLaneWrite(r.lanes, str(args.tag) ?? null)
      const input: CreateTaskInput = {
        title,
        notes: str(args.notes) ?? null,
        tag: str(args.tag),
        date: str(args.date) ?? null,
        startTime: str(args.startTime) ?? null,
        endTime: str(args.endTime) ?? null,
        metadata: obj(args.metadata) ?? null
      }
      const { id } = await TaskHandlers.createTask(r.storage, r.auth, input, r.boardId)
      return findTask(r, id)
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
      const r = await resolveBoard(args, ctx, { write: true })
      // Human path (§5.2): only enforce when this update changes the tag.
      if (args.tag !== undefined && r.mode === 'automation') {
        assertHumanLaneWrite(r.lanes, str(args.tag) ?? null)
      }
      const input: UpdateTaskInput = {}
      if (args.title !== undefined) input.title = str(args.title)
      if (args.notes !== undefined) input.notes = str(args.notes) ?? null
      if (args.tag !== undefined) input.tag = str(args.tag)
      if (args.date !== undefined) input.date = str(args.date) ?? null
      if (args.startTime !== undefined) input.startTime = str(args.startTime) ?? null
      if (args.endTime !== undefined) input.endTime = str(args.endTime) ?? null
      if (args.metadata !== undefined) input.metadata = obj(args.metadata) ?? null
      await TaskHandlers.updateTask(r.storage, r.auth, id, input, r.boardId)
      return findTask(r, id)
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
        notes: {
          type: 'string',
          description: 'The full markdown body. Replaces any existing notes.'
        },
        ...boardProp
      },
      required: ['id', 'notes']
    },
    handler: async (args, ctx) => {
      const id = requireId(args)
      const r = await resolveBoard(args, ctx, { write: true })
      const notes = str(args.notes) ?? ''
      await TaskHandlers.updateTask(r.storage, r.auth, id, { notes }, r.boardId)
      return findTask(r, id)
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
      const r = await resolveBoard(args, ctx, { write: true })
      const input: UpdateTaskInput =
        args.clear === true
          ? { date: null, startTime: null, endTime: null }
          : {
              date: str(args.date) ?? null,
              startTime: str(args.startTime) ?? null,
              endTime: str(args.endTime) ?? null
            }
      await TaskHandlers.updateTask(r.storage, r.auth, id, input, r.boardId)
      return findTask(r, id)
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
      const r = await resolveBoard(args, ctx, { write: true })
      return TaskHandlers.completeTask(r.storage, r.auth, id, r.boardId)
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
      const r = await resolveBoard(args, ctx, { write: true })
      return TaskHandlers.deleteTask(r.storage, r.auth, id, r.boardId)
    }
  },
  {
    name: 'get_calendar',
    description:
      "A board's calendar (§9): its scheduled tasks — everything carrying a calendar day — " +
      'ordered by day then start time. Narrow with `from`/`to` (inclusive "YYYY-MM-DD") and/or ' +
      '`source` to see only what one provider mirrored. The calendar belongs to the board, so a ' +
      "board shared with you exposes the OWNER's calendar here; to add to it, create_task on the " +
      'same board with date or startTime/endTime.',
    inputSchema: {
      type: 'object',
      properties: {
        ...boardProp,
        from: { type: 'string', description: 'Inclusive first day, "YYYY-MM-DD".' },
        to: { type: 'string', description: 'Inclusive last day, "YYYY-MM-DD".' },
        source: {
          type: 'string',
          description: 'Only tasks mirrored from this provider, e.g. "contact".'
        }
      }
    },
    handler: async (args, ctx) => {
      const r = await resolveBoard(args, ctx)
      const result = await TaskHandlers.getBoardCalendar(r.storage, r.auth, r.boardId, {
        from: str(args.from) ?? null,
        to: str(args.to) ?? null,
        source: str(args.source) ?? null
      })
      return {
        board: boardOf(args, ctx),
        canWrite: r.access !== 'readonly',
        from: result.from,
        to: result.to,
        scheduled: result.scheduled,
        count: result.tasks.length,
        tasks: result.tasks
      }
    }
  },
  {
    name: 'list_boards',
    description:
      'List the available boards — your own plus any shared with you — each with its `calendar` (§9). For a SHARED board (access "contributor"/"readonly"), address task tools by its `handle`, not its `id`; your own board `id` only ever resolves within your own tasks. `calendar.ref` is always the reference that works for you.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const boards = await TaskHandlers.getBoards(ctx.storage, ctx.auth)
      // getBoards hydrates tasks in the CALLER's scope, which is empty for a board
      // shared with them (the rows are the OWNER's) — so the calendar count it
      // derived would read 0. Recompute those from the owner's scope, in parallel.
      await Promise.all(
        boards.boards.map(async b => {
          if (!b.access || b.access === 'owner') return
          const r = await ctx.resolve(b.id)
          if (!r) return
          b.tasks = await TaskHandlers.getBoardTasks(r.storage, r.auth, r.boardId)
          b.calendar = TaskHandlers.boardCalendar(b)
        })
      )
      return {
        boards: boards.boards.map(b => ({
          id: b.id,
          name: b.name,
          tags: b.tags,
          handle: b.handle,
          access: b.access ?? 'owner',
          ownerUserId: b.ownerUserId,
          // The board's calendar travels with the board (§9): `calendar.ref` is
          // what to address it by, so a caller never infers which calendar it has.
          calendar: b.calendar,
          // Automation (§5): a runner reads the lane vocabulary here. `mode` is
          // 'standard' | 'automation'; `lanes` present only when automation.
          mode: b.mode ?? 'standard',
          lanes: b.lanes ?? undefined
        }))
      }
    }
  },
  {
    name: 'create_board',
    description:
      'Create a board (your own). Use for a per-repo automation board before activating it (activation itself is owner-only and done over HTTP / the app). `id` is a slug; a globally-unique handle is minted server-side.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Board slug, e.g. "my-repo".' },
        name: { type: 'string', description: 'Display name.' }
      },
      required: ['id', 'name']
    },
    handler: async (args, ctx) => {
      const id = str(args.id)
      const name = str(args.name)
      if (!id || !name) throw new Error('`id` and `name` are required')
      return TaskHandlers.createBoard(ctx.storage, ctx.auth, { id, name })
    }
  },
  {
    name: 'get_board',
    description:
      'One board, fully hydrated (§5.5): its metadata (repo, mode, lanes) plus every active task, each flagged `claimed` if a live lease holds it. How a runner sees all its work in one call. Address a shared board by its handle.',
    inputSchema: {
      type: 'object',
      properties: { board: { type: 'string', description: 'Board handle or your own slug.' } },
      required: ['board']
    },
    handler: async (args, ctx) => {
      const r = await resolveBoard(args, ctx)
      const cfg = await getBoardConfig(ctx.db, r.ownerId, r.boardId)
      if (!cfg) throw new Error(`Board ${boardOf(args, ctx)} not found`)
      const tasks = await TaskHandlers.getBoardTasks(r.storage, r.auth, r.boardId)
      const claimed = await liveClaimedTaskIds(ctx.db, r.ownerId, r.boardId)
      const ref = boardOf(args, ctx)
      return {
        board: {
          id: r.boardId,
          name: cfg.name,
          handle: cfg.handle,
          repo: cfg.repo,
          mode: cfg.mode,
          lanes: cfg.lanes,
          access: r.access,
          ownerUserId: r.ownerId,
          // §9: the calendar is a property of the board. `ref` echoes the
          // reference THIS caller used, since that's the one that resolves.
          calendar: TaskHandlers.boardCalendar({
            id: ref,
            name: cfg.name,
            tags: [],
            tasks,
            access: r.access
          })
        },
        tasks: tasks.map(t => ({ ...t, claimed: claimed.has(t.id) }))
      }
    }
  },
  // --- Agent claim protocol (§4) ---
  {
    name: 'claim_task',
    description:
      "Atomically claim a task for work (§4). Returns { token, expiresAt } on success; fails with CLAIM_HELD if another agent holds a live lease. Optionally move the task into `lane` in the same step (the agent path — you may enter an `agent` lane a human can't). Heartbeat before `expiresAt` to keep the lease.",
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The task to claim.' },
        ...boardProp,
        agentId: {
          type: 'string',
          description: 'A label for you, shown in claim history. Defaults to your id.'
        },
        lane: { type: 'string', description: 'Optional: move the task into this lane on claim.' },
        leaseSeconds: { type: 'number', description: 'Lease length (default 1800, max 3600).' }
      },
      required: ['taskId']
    },
    handler: async (args, ctx) => {
      const taskId = str(args.taskId)
      if (!taskId) throw new Error('`taskId` is required')
      const r = await resolveBoard(args, ctx, { write: true })
      return claimTask(ctx.db, r.ownerId, r.boardId, taskId, str(args.agentId) ?? ctx.callerId, {
        lane: str(args.lane) ?? null,
        leaseSeconds: typeof args.leaseSeconds === 'number' ? args.leaseSeconds : undefined,
        mode: r.mode,
        lanes: r.lanes
      })
    }
  },
  {
    name: 'heartbeat_claim',
    description:
      'Extend your lease on a claimed task (§4). Fails with LEASE_LOST if your lease already expired and was taken — abort and write nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        token: { type: 'string', description: 'The token from claim_task.' },
        ...boardProp,
        leaseSeconds: { type: 'number' }
      },
      required: ['taskId', 'token']
    },
    handler: async (args, ctx) => {
      const taskId = str(args.taskId)
      const token = str(args.token)
      if (!taskId || !token) throw new Error('`taskId` and `token` are required')
      const r = await resolveBoard(args, ctx, { write: true })
      return heartbeatClaim(
        ctx.db,
        r.ownerId,
        taskId,
        token,
        typeof args.leaseSeconds === 'number' ? args.leaseSeconds : undefined
      )
    }
  },
  {
    name: 'set_lane',
    description:
      "Move a task into a lane while holding its claim (§4) — the agent path, so `agent` lanes are allowed. LANE_UNKNOWN if the lane isn't on the board; LEASE_LOST if you no longer hold the claim.",
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        token: { type: 'string' },
        lane: { type: 'string', description: 'Destination lane tag.' },
        ...boardProp
      },
      required: ['taskId', 'token', 'lane']
    },
    handler: async (args, ctx) => {
      const taskId = str(args.taskId)
      const token = str(args.token)
      const lane = str(args.lane)
      if (!taskId || !token || lane === undefined)
        throw new Error('`taskId`, `token` and `lane` are required')
      const r = await resolveBoard(args, ctx, { write: true })
      return setLane(ctx.db, r.ownerId, r.boardId, taskId, token, lane ?? '', {
        mode: r.mode,
        lanes: r.lanes
      })
    }
  },
  {
    name: 'release_claim',
    description:
      "Release a claim (§4): move the task to `lane`, optionally write `notes` (the result/plan), merge `metadata`, and unclaim. Idempotent on token. Pass `ifCurrentLane` to abort with LANE_CHANGED if a human retagged the task under you. Pass `complete: true` to archive the task on release (still claim-gated) so a notification lane doesn't grow unbounded.",
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        token: { type: 'string' },
        lane: {
          type: 'string',
          description: 'Where the task goes on release (agent lane allowed). Omit / empty ⇒ Inbox.'
        },
        notes: { type: 'string', description: 'Markdown result/plan to write on the task.' },
        metadata: {
          type: 'object',
          description:
            'Arbitrary JSON merged onto the task (you hold the claim, so this is allowed).'
        },
        outcome: {
          type: 'string',
          description: "Free-text outcome label for the claim history; we don't interpret it."
        },
        ifCurrentLane: {
          type: 'string',
          description: 'Guard: abort (LANE_CHANGED) unless the task is still in this lane.'
        },
        complete: {
          type: 'boolean',
          description: 'Archive the task on release (removes it from the active list).'
        },
        ...boardProp
      },
      required: ['taskId', 'token']
    },
    handler: async (args, ctx) => {
      const taskId = str(args.taskId)
      const token = str(args.token)
      if (!taskId || !token) throw new Error('`taskId` and `token` are required')
      const r = await resolveBoard(args, ctx, { write: true })
      return releaseClaim(ctx.db, r.ownerId, r.boardId, taskId, token, {
        lane: str(args.lane) ?? null,
        notes: args.notes !== undefined ? (str(args.notes) ?? '') : undefined,
        metadata: obj(args.metadata) ?? undefined,
        outcome: str(args.outcome) ?? null,
        ifCurrentLane:
          args.ifCurrentLane !== undefined ? (str(args.ifCurrentLane) ?? '') : undefined,
        complete: args.complete === true,
        mode: r.mode,
        lanes: r.lanes
      })
    }
  },
  {
    name: 'get_claim_history',
    description: 'Claim history for a task (§5.7) — who claimed it when, and how each claim ended.',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, ...boardProp },
      required: ['taskId']
    },
    handler: async (args, ctx) => {
      const taskId = str(args.taskId)
      if (!taskId) throw new Error('`taskId` is required')
      const r = await resolveBoard(args, ctx)
      return { history: await getClaimHistory(ctx.db, r.ownerId, taskId) }
    }
  },
  {
    name: 'cancel_claim',
    description:
      "Owner force-drops the claim on a task (§ cancel path) — reclaim a stuck/held task by hand. The holding agent's next heartbeat then sees no live claim and gets LEASE_LOST. Owner-only.",
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string' }, ...boardProp },
      required: ['taskId']
    },
    handler: async (args, ctx) => {
      const taskId = str(args.taskId)
      if (!taskId) throw new Error('`taskId` is required')
      const r = await resolveBoard(args, ctx, { write: true })
      if (r.access !== 'owner') throw new Error('Only the board owner can cancel a claim')
      return cancelClaim(ctx.db, r.ownerId, taskId)
    }
  },
  {
    name: 'list_changes',
    description:
      'Poll the change feed (§4.4): your tasks whose (updatedAt, id) sort after `since`, so a runner stops full-scanning. Deletes appear as rows with state "Deleted". Returns a `cursor` to pass as the next `since`.',
    inputSchema: {
      type: 'object',
      properties: {
        since: {
          type: 'string',
          description: 'Cursor "<updatedAt>,<id>" from a prior call; omit for a full initial sweep.'
        },
        limit: { type: 'number', description: 'Max rows (default 100, max 500).' }
      }
    },
    handler: async (args, ctx) => {
      const since = str(args.since)
      let cursor: { updatedAt: string; id: string } | null = null
      if (since) {
        const comma = since.lastIndexOf(',')
        if (comma > 0) cursor = { updatedAt: since.slice(0, comma), id: since.slice(comma + 1) }
      }
      return getChanges(
        ctx.db,
        ctx.callerId,
        cursor,
        typeof args.limit === 'number' ? args.limit : 100
      )
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
