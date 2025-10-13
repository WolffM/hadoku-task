/**
 * Pure business logic handlers for task operations
 * These functions are completely framework-agnostic and can be used with any web framework
 */

import type { Storage } from './storage.js';
import type {
  AuthContext,
  Task,
  TasksFile,
  StatsFile,
  BoardsFile,
  UserType,
  CreateTaskInput,
  UpdateTaskInput,
  ULID
} from './types.js';
import { generateULID, now } from './utils.js';

/**
 * Update stats after a task creation
 */
function recordCreation(stats: StatsFile, task: Task, timestamp: string): StatsFile {
  return {
    ...stats,
    updatedAt: timestamp,
    counters: {
      ...stats.counters,
      created: stats.counters.created + 1
    },
    timeline: [
      ...stats.timeline,
      { t: timestamp, event: 'created', id: task.id }
    ],
    tasks: {
      ...stats.tasks,
      [task.id]: { ...task }
    }
  };
}

/**
 * Update stats after a task completion
 */
function recordCompletion(stats: StatsFile, task: Task, timestamp: string): StatsFile {
  return {
    ...stats,
    updatedAt: timestamp,
    counters: {
      ...stats.counters,
      completed: stats.counters.completed + 1
    },
    timeline: [
      ...stats.timeline,
      { t: timestamp, event: 'completed', id: task.id }
    ],
    tasks: {
      ...stats.tasks,
      [task.id]: { ...task }
    }
  };
}

/**
 * Update stats after a task update
 */
function recordUpdate(stats: StatsFile, task: Task, timestamp: string): StatsFile {
  return {
    ...stats,
    updatedAt: timestamp,
    counters: {
      ...stats.counters,
      edited: stats.counters.edited + 1
    },
    timeline: [
      ...stats.timeline,
      { t: timestamp, event: 'edited', id: task.id }
    ],
    tasks: {
      ...stats.tasks,
      [task.id]: { ...task }
    }
  };
}

/**
 * Update stats after a task deletion
 */
function recordDeletion(stats: StatsFile, task: Task, timestamp: string): StatsFile {
  return {
    ...stats,
    updatedAt: timestamp,
    counters: {
      ...stats.counters,
      deleted: stats.counters.deleted + 1
    },
    timeline: [
      ...stats.timeline,
      { t: timestamp, event: 'deleted', id: task.id }
    ],
    tasks: {
      ...stats.tasks,
      [task.id]: { ...task }
    }
  };
}

// --- Read Operations ---

/**
 * Get all boards for a user
 * Supports multi-board structure with tasks organized by board
 * Public users get in-memory boards (for testing/development)
 */
export async function getBoards(
  storage: Storage,
  auth: AuthContext & { userId?: string }
): Promise<BoardsFile> {
  // Public users can use boards with in-memory storage
  return await storage.getBoards(auth.userType, auth.userId);
}

/**
 * Get all tasks for a user
 * Internal use only - used by write operations that haven't been migrated to boards yet
 */
async function getTasks(
  storage: Storage,
  userType: UserType
): Promise<TasksFile> {
  return await storage.getTasks(userType);
}

/**
 * Get stats for a user
 * Internal use only - used by write operations that haven't been migrated to boards yet
 */
async function getStats(
  storage: Storage,
  userType: UserType
): Promise<StatsFile> {
  return await storage.getStats(userType);
}

// --- Write Operations ---

/**
 * Create a new task
 * Public users cannot create tasks
 */
export async function createTask(
  storage: Storage,
  auth: AuthContext,
  input: CreateTaskInput
): Promise<{ ok: boolean; id: ULID }> {
  if (auth.userType === 'public') {
    throw new Error('Forbidden: Public users cannot create tasks');
  }

  const timestamp = now();
  const tasks = await getTasks(storage, auth.userType);
  const stats = await getStats(storage, auth.userType);

  const id = generateULID();
  const newTask: Task = {
    id,
    title: input.title,
    tag: input.tag ?? null,
    state: 'Active',
    createdAt: timestamp
  };

  const updatedTasks: TasksFile = {
    ...tasks,
    tasks: [newTask, ...tasks.tasks],
    updatedAt: timestamp
  };

  const updatedStats = recordCreation(stats, newTask, timestamp);

  await storage.saveTasks(auth.userType, updatedTasks);
  await storage.saveStats(auth.userType, updatedStats);

  return { ok: true, id };
}

/**
 * Update an existing task
 * Public users cannot update tasks
 */
export async function updateTask(
  storage: Storage,
  auth: AuthContext,
  taskId: ULID,
  input: UpdateTaskInput
): Promise<{ ok: boolean; message: string }> {
  if (auth.userType === 'public') {
    throw new Error('Forbidden: Public users cannot update tasks');
  }

  const timestamp = now();
  const tasks = await getTasks(storage, auth.userType);
  const stats = await getStats(storage, auth.userType);

  const taskIndex = tasks.tasks.findIndex(t => t.id === taskId);
  if (taskIndex < 0) {
    throw new Error('Task not found');
  }

  const task = tasks.tasks[taskIndex];
  const updatedTask: Task = {
    ...task,
    ...input,
    updatedAt: timestamp
  };

  const newTasks = [...tasks.tasks];
  newTasks[taskIndex] = updatedTask;

  const updatedTasksFile: TasksFile = {
    ...tasks,
    tasks: newTasks,
    updatedAt: timestamp
  };

  const updatedStats = recordUpdate(stats, updatedTask, timestamp);

  await storage.saveTasks(auth.userType, updatedTasksFile);
  await storage.saveStats(auth.userType, updatedStats);

  return { ok: true, message: `Task ${taskId} updated` };
}

/**
 * Complete a task (removes from active tasks, records in stats)
 * Public users cannot complete tasks
 */
export async function completeTask(
  storage: Storage,
  auth: AuthContext,
  taskId: ULID
): Promise<{ ok: boolean; message: string }> {
  if (auth.userType === 'public') {
    throw new Error('Forbidden: Public users cannot complete tasks');
  }

  const timestamp = now();
  const tasks = await getTasks(storage, auth.userType);
  const stats = await getStats(storage, auth.userType);

  const taskIndex = tasks.tasks.findIndex(t => t.id === taskId);
  if (taskIndex < 0) {
    throw new Error('Task not found');
  }

  const task = tasks.tasks[taskIndex];
  const completedTask: Task = {
    ...task,
    state: 'Completed',
    closedAt: timestamp,
    updatedAt: timestamp
  };

  const newTasks = [...tasks.tasks];
  newTasks.splice(taskIndex, 1); // Remove from active tasks

  const updatedTasksFile: TasksFile = {
    ...tasks,
    tasks: newTasks,
    updatedAt: timestamp
  };

  const updatedStats = recordCompletion(stats, completedTask, timestamp);

  await storage.saveTasks(auth.userType, updatedTasksFile);
  await storage.saveStats(auth.userType, updatedStats);

  return { ok: true, message: `Task ${taskId} completed` };
}

/**
 * Delete a task (removes from active tasks, records in stats)
 */
export async function deleteTask(
  storage: Storage,
  auth: AuthContext,
  taskId: ULID
): Promise<{ ok: boolean; message: string }> {
  const timestamp = now();
  const tasks = await getTasks(storage, auth.userType);
  const stats = await getStats(storage, auth.userType);

  const taskIndex = tasks.tasks.findIndex(t => t.id === taskId);
  if (taskIndex < 0) {
    throw new Error('Task not found');
  }

  const task = tasks.tasks[taskIndex];
  const deletedTask: Task = {
    ...task,
    state: 'Deleted',
    closedAt: timestamp,
    updatedAt: timestamp
  };

  const newTasks = [...tasks.tasks];
  newTasks.splice(taskIndex, 1); // Remove from active tasks

  const updatedTasksFile: TasksFile = {
    ...tasks,
    tasks: newTasks,
    updatedAt: timestamp
  };

  const updatedStats = recordDeletion(stats, deletedTask, timestamp);

  await storage.saveTasks(auth.userType, updatedTasksFile);
  await storage.saveStats(auth.userType, updatedStats);

  return { ok: true, message: `Task ${taskId} deleted` };
}

/**
 * Clear all tasks (public users only, resets localStorage-style behavior)
 * This is only for public mode compatibility
 */
export async function clearTasks(
  storage: Storage,
  auth: AuthContext
): Promise<{ ok: boolean; message: string }> {
  if (auth.userType !== 'public') {
    throw new Error('Forbidden: Only public users can clear tasks');
  }

  const timestamp = now();
  const emptyTasks: TasksFile = {
    version: 1,
    updatedAt: timestamp,
    tasks: []
  };

  const emptyStats: StatsFile = {
    version: 2,
    updatedAt: timestamp,
    counters: { created: 0, completed: 0, edited: 0, deleted: 0 },
    timeline: [],
    tasks: {}
  };

  await storage.saveTasks(auth.userType, emptyTasks);
  await storage.saveStats(auth.userType, emptyStats);

  return { ok: true, message: 'Public tasks cleared' };
}
