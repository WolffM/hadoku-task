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
import {
  findTaskOrThrow,
  findBoardOrThrow,
  updateBoardAtIndex
} from './handlers-utils.js';

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
  // Get board metadata (id, name, tags only in v2 architecture)
  const boardsFile = await storage.getBoards(auth.userType, auth.userId);
  
  // Populate each board with its tasks and stats from separate storage
  const populatedBoards = await Promise.all(
    boardsFile.boards.map(async (board) => {
      // Fetch tasks for this board
      const tasksFile = await storage.getTasks(auth.userType, auth.userId, board.id);
      // Fetch stats for this board
      const statsFile = await storage.getStats(auth.userType, auth.userId, board.id);
      
      return {
        ...board,
        tasks: tasksFile.tasks,
        stats: statsFile
      };
    })
  );
  
  return {
    ...boardsFile,
    boards: populatedBoards
  };
}

/**
 * Get tasks for a specific board (board-scoped storage v2)
 */
export async function getBoardTasks(
  storage: Storage,
  auth: AuthContext & { userId?: string },
  boardId: string
): Promise<Task[]> {
  const tasks = await storage.getTasks(auth.userType, auth.userId, boardId);
  return tasks.tasks;
}

/**
 * Get stats for a specific board (board-scoped storage v2)
 */
export async function getBoardStats(
  storage: Storage,
  auth: AuthContext & { userId?: string },
  boardId: string
): Promise<StatsFile> {
  const stats = await storage.getStats(auth.userType, auth.userId, boardId);
  return stats;
}

// --- Write Operations ---

/**
 * Create a new task (board-scoped storage v2)
 * Public users cannot create tasks
 */
export async function createTask(
  storage: Storage,
  auth: AuthContext & { userId?: string },
  input: CreateTaskInput,
  boardId: string = 'main'
): Promise<{ ok: boolean; id: ULID }> {
  const timestamp = now();
  
  // Get board-scoped tasks and stats
  const tasks = await storage.getTasks(auth.userType, auth.userId, boardId);
  const stats = await storage.getStats(auth.userType, auth.userId, boardId);

  // Use client-provided ID if available, otherwise generate server-side
  const id = input.id || generateULID();
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

  await storage.saveTasks(auth.userType, auth.userId, boardId, updatedTasks);
  await storage.saveStats(auth.userType, auth.userId, boardId, updatedStats);

  return { ok: true, id };
}

/**
 * Update an existing task (board-scoped storage v2)
 * Public users cannot update tasks
 */
export async function updateTask(
  storage: Storage,
  auth: AuthContext & { userId?: string },
  taskId: ULID,
  input: UpdateTaskInput,
  boardId: string = 'main'
): Promise<{ ok: boolean; message: string }> {
  const timestamp = now();
  
  // Get board-scoped tasks and stats
  const tasks = await storage.getTasks(auth.userType, auth.userId, boardId);
  const stats = await storage.getStats(auth.userType, auth.userId, boardId);

  const { task, index: taskIndex } = findTaskOrThrow(tasks, taskId);

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

  await storage.saveTasks(auth.userType, auth.userId, boardId, updatedTasksFile);
  await storage.saveStats(auth.userType, auth.userId, boardId, updatedStats);

  return { ok: true, message: `Task ${taskId} updated` };
}

/**
 * Complete a task (removes from active tasks, records in stats) - board-scoped storage v2
 * Public users cannot complete tasks
 */
export async function completeTask(
  storage: Storage,
  auth: AuthContext & { userId?: string },
  taskId: ULID,
  boardId: string = 'main'
): Promise<{ ok: boolean; message: string }> {
  const timestamp = now();
  
  // Get board-scoped tasks and stats
  const tasks = await storage.getTasks(auth.userType, auth.userId, boardId);
  const stats = await storage.getStats(auth.userType, auth.userId, boardId);

  const { task, index: taskIndex } = findTaskOrThrow(tasks, taskId);

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

  await storage.saveTasks(auth.userType, auth.userId, boardId, updatedTasksFile);
  await storage.saveStats(auth.userType, auth.userId, boardId, updatedStats);

  return { ok: true, message: `Task ${taskId} completed` };
}

/**
 * Delete a task (removes from active tasks, records in stats) - board-scoped storage v2
 */
export async function deleteTask(
  storage: Storage,
  auth: AuthContext & { userId?: string },
  taskId: ULID,
  boardId: string = 'main'
): Promise<{ ok: boolean; message: string }> {
  const timestamp = now();
  
  // Get board-scoped tasks and stats
  const tasks = await storage.getTasks(auth.userType, auth.userId, boardId);
  const stats = await storage.getStats(auth.userType, auth.userId, boardId);

  const { task, index: taskIndex } = findTaskOrThrow(tasks, taskId);

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

  await storage.saveTasks(auth.userType, auth.userId, boardId, updatedTasksFile);
  await storage.saveStats(auth.userType, auth.userId, boardId, updatedStats);

  return { ok: true, message: `Task ${taskId} deleted` };
}

// --- Board Operations ---

/**
 * Create a new board
 */
export async function createBoard(
  storage: Storage,
  auth: AuthContext & { userId?: string },
  input: { id: string; name: string }
): Promise<{ ok: boolean; board: { id: string; name: string; tasks: Task[]; tags: string[] } }> {
  const timestamp = now();
  const boards = await storage.getBoards(auth.userType, auth.userId);
  
  // Check if board already exists
  if (boards.boards.find(b => b.id === input.id)) {
    throw new Error(`Board ${input.id} already exists`);
  }
  
  const newBoard = {
    id: input.id,
    name: input.name,
    tasks: [],
    tags: []
  };
  
  const updatedBoards: BoardsFile = {
    ...boards,
    updatedAt: timestamp,
    boards: [...boards.boards, newBoard]
  };
  
  await storage.saveBoards(auth.userType, updatedBoards, auth.userId);
  
  return { ok: true, board: newBoard };
}

/**
 * Delete a board
 */
export async function deleteBoard(
  storage: Storage,
  auth: AuthContext & { userId?: string },
  boardId: string
): Promise<{ ok: boolean; message: string }> {
  // Prevent deleting the main board
  if (boardId === 'main') {
    throw new Error('Cannot delete the main board');
  }

  const timestamp = now();
  const boards = await storage.getBoards(auth.userType, auth.userId);
  
  const { index: boardIndex } = findBoardOrThrow(boards, boardId);
  
  const updatedBoards: BoardsFile = {
    ...boards,
    updatedAt: timestamp,
    boards: boards.boards.filter(b => b.id !== boardId)
  };
  
  await storage.saveBoards(auth.userType, updatedBoards, auth.userId);
  
  return { ok: true, message: `Board ${boardId} deleted` };
}

// --- Tag Operations ---

/**
 * Add a tag to a board
 */
export async function createTag(
  storage: Storage,
  auth: AuthContext & { userId?: string },
  input: { boardId: string; tag: string }
): Promise<{ ok: boolean; message: string }> {
  const timestamp = now();
  const boards = await storage.getBoards(auth.userType, auth.userId);
  
  const { board, index: boardIndex } = findBoardOrThrow(boards, input.boardId);
  
  const existingTags = board.tags || [];
  
  // Check if tag already exists
  if (existingTags.includes(input.tag)) {
    return { ok: true, message: `Tag ${input.tag} already exists` };
  }
  
  const updatedBoard = {
    ...board,
    tags: [...existingTags, input.tag]
  };
  
  const updatedBoards = updateBoardAtIndex(boards, boardIndex, updatedBoard, timestamp);
  
  await storage.saveBoards(auth.userType, updatedBoards, auth.userId);
  
  return { ok: true, message: `Tag ${input.tag} added to board ${input.boardId}` };
}

/**
 * Remove a tag from a board
 */
export async function deleteTag(
  storage: Storage,
  auth: AuthContext & { userId?: string },
  input: { boardId: string; tag: string }
): Promise<{ ok: boolean; message: string }> {
  const timestamp = now();
  const boards = await storage.getBoards(auth.userType, auth.userId);
  
  const { board, index: boardIndex } = findBoardOrThrow(boards, input.boardId);
  
  const existingTags = board.tags || [];
  
  const updatedBoard = {
    ...board,
    tags: existingTags.filter(t => t !== input.tag)
  };
  
  const updatedBoards = updateBoardAtIndex(boards, boardIndex, updatedBoard, timestamp);
  
  await storage.saveBoards(auth.userType, updatedBoards, auth.userId);
  
  return { ok: true, message: `Tag ${input.tag} removed from board ${input.boardId}` };
}
