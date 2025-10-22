/**
 * Pure business logic handlers for task operations
 * These functions are completely framework-agnostic and can be used with any web framework
 */

import type { Storage } from '../../server/storage.js';
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
} from '../types.js';
import { generateULID, now } from '../utils/shared.js';
import {
  findTaskOrThrow,
  findBoardOrThrow,
  updateBoardAtIndex,
  recordStatsEvent,
  extractTasksFromBoard,
  prepareTasksForBoard,
  updateBatchMoveStats,
  closeTask,
  withTaskOperation,
  withBoardOperation
} from './handlers-utils.js';

// --- Read Operations ---

/**
 * Get all boards for a user
 * Supports multi-board structure with tasks organized by board
 * Public users get in-memory boards (for testing/development)
 */
export async function getBoards(
  storage: Storage,
  auth: AuthContext
): Promise<BoardsFile> {
  // Get board metadata (id, name, tags only in board-scoped architecture)
  const boardsFile = await storage.getBoards(auth.userType, auth.sessionId);
  
  // Populate each board with its tasks and stats from separate storage
  const populatedBoards = await Promise.all(
    boardsFile.boards.map(async (board) => {
      // Fetch tasks for this board
      const tasksFile = await storage.getTasks(auth.userType, auth.sessionId, board.id);
      // Fetch stats for this board
      const statsFile = await storage.getStats(auth.userType, auth.sessionId, board.id);
      
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
 * Get tasks for a specific board (board-scoped storage)
 */
export async function getBoardTasks(
  storage: Storage,
  auth: AuthContext,
  boardId: string
): Promise<Task[]> {
  const tasks = await storage.getTasks(auth.userType, auth.sessionId, boardId);
  return tasks.tasks;
}

/**
 * Get stats for a specific board (board-scoped storage)
 */
export async function getBoardStats(
  storage: Storage,
  auth: AuthContext,
  boardId: string
): Promise<StatsFile> {
  const stats = await storage.getStats(auth.userType, auth.sessionId, boardId);
  return stats;
}

// --- Write Operations ---

/**
 * Create a new task (board-scoped storage)
 * Public users cannot create tasks
 */
export async function createTask(
  storage: Storage,
  auth: AuthContext,
  input: CreateTaskInput,
  boardId: string = 'main'
): Promise<{ ok: boolean; id: ULID }> {
  return withTaskOperation(storage, auth, boardId, (tasks, stats, timestamp) => {
    // Use client-provided ID if available, otherwise generate server-side
    const id = input.id || generateULID();
    // Use client-provided createdAt if available (for preserving during moves), otherwise use current timestamp
    const createdAt = input.createdAt || timestamp;
    
    const newTask: Task = {
      id,
      title: input.title,
      tag: input.tag ?? null,
      state: 'Active',
      createdAt
    };

    return {
      updatedTasks: {
        ...tasks,
        tasks: [newTask, ...tasks.tasks],
        updatedAt: timestamp
      },
      statsEvents: [{ task: newTask, eventType: 'created' }],
      result: { ok: true, id }
    };
  });
}

/**
 * Update an existing task (board-scoped storage)
 * Public users cannot update tasks
 */
export async function updateTask(
  storage: Storage,
  auth: AuthContext,
  taskId: ULID,
  input: UpdateTaskInput,
  boardId: string = 'main'
): Promise<{ ok: boolean; message: string }> {
  return withTaskOperation(storage, auth, boardId, (tasks, stats, timestamp) => {
    const { task, index: taskIndex } = findTaskOrThrow(tasks, taskId);

    const updatedTask: Task = {
      ...task,
      ...input,
      updatedAt: timestamp
    };

    const newTasks = [...tasks.tasks];
    newTasks[taskIndex] = updatedTask;

    return {
      updatedTasks: {
        ...tasks,
        tasks: newTasks,
        updatedAt: timestamp
      },
      statsEvents: [{ task: updatedTask, eventType: 'edited' }],
      result: { ok: true, message: `Task ${taskId} updated` }
    };
  });
}

/**
 * Complete a task (removes from active tasks, records in stats) - board-scoped storage
 * Public users cannot complete tasks
 */
export async function completeTask(
  storage: Storage,
  auth: AuthContext,
  taskId: ULID,
  boardId: string = 'main'
): Promise<{ ok: boolean; message: string }> {
  return withTaskOperation(storage, auth, boardId, (tasks, stats, timestamp) => {
    const { updatedTasks, closedTask } = closeTask(tasks, taskId, 'Completed', timestamp);
    
    return {
      updatedTasks,
      statsEvents: [{ task: closedTask, eventType: 'completed' }],
      result: { ok: true, message: `Task ${taskId} completed` }
    };
  });
}

/**
 * Delete a task (removes from active tasks, records in stats) - board-scoped storage
 */
export async function deleteTask(
  storage: Storage,
  auth: AuthContext,
  taskId: ULID,
  boardId: string = 'main'
): Promise<{ ok: boolean; message: string }> {
  return withTaskOperation(storage, auth, boardId, (tasks, stats, timestamp) => {
    const { updatedTasks, closedTask } = closeTask(tasks, taskId, 'Deleted', timestamp);
    
    return {
      updatedTasks,
      statsEvents: [{ task: closedTask, eventType: 'deleted' }],
      result: { ok: true, message: `Task ${taskId} deleted` }
    };
  });
}

// --- Board Operations ---

/**
 * Create a new board
 */
export async function createBoard(
  storage: Storage,
  auth: AuthContext,
  input: { id: string; name: string }
): Promise<{ ok: boolean; board: { id: string; name: string; tasks: Task[]; tags: string[] } }> {
  return withBoardOperation(storage, auth, (boards, timestamp) => {
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
    
    return {
      updatedBoards,
      result: { ok: true, board: newBoard }
    };
  });
}

/**
 * Delete a board
 */
export async function deleteBoard(
  storage: Storage,
  auth: AuthContext,
  boardId: string
): Promise<{ ok: boolean; message: string }> {
  // Prevent deleting the main board
  if (boardId === 'main') {
    throw new Error('Cannot delete the main board');
  }

  return withBoardOperation(storage, auth, (boards, timestamp) => {
    // Validate board exists
    findBoardOrThrow(boards, boardId);
    
    const updatedBoards: BoardsFile = {
      ...boards,
      updatedAt: timestamp,
      boards: boards.boards.filter(b => b.id !== boardId)
    };
    
    return {
      updatedBoards,
      result: { ok: true, message: `Board ${boardId} deleted` }
    };
  });
}

// --- Tag Operations ---

/**
 * Add a tag to a board
 */
export async function createTag(
  storage: Storage,
  auth: AuthContext,
  input: { boardId: string; tag: string }
): Promise<{ ok: boolean; message: string }> {
  return withBoardOperation(storage, auth, (boards, timestamp) => {
    const { board, index: boardIndex } = findBoardOrThrow(boards, input.boardId);
    
    const existingTags = board.tags || [];
    
    // Check if tag already exists
    if (existingTags.includes(input.tag)) {
      return {
        updatedBoards: boards, // No changes needed
        result: { ok: true, message: `Tag ${input.tag} already exists` }
      };
    }
    
    const updatedBoard = {
      ...board,
      tags: [...existingTags, input.tag]
    };
    
    return {
      updatedBoards: updateBoardAtIndex(boards, boardIndex, updatedBoard, timestamp),
      result: { ok: true, message: `Tag ${input.tag} added to board ${input.boardId}` }
    };
  });
}

/**
 * Remove a tag from a board
 */
export async function deleteTag(
  storage: Storage,
  auth: AuthContext,
  input: { boardId: string; tag: string }
): Promise<{ ok: boolean; message: string }> {
  return withBoardOperation(storage, auth, (boards, timestamp) => {
    const { board, index: boardIndex } = findBoardOrThrow(boards, input.boardId);
    
    const existingTags = board.tags || [];
    
    const updatedBoard = {
      ...board,
      tags: existingTags.filter((t: string) => t !== input.tag)
    };
    
    return {
      updatedBoards: updateBoardAtIndex(boards, boardIndex, updatedBoard, timestamp),
      result: { ok: true, message: `Tag ${input.tag} removed from board ${input.boardId}` }
    };
  });
}

// --- Batch Operations ---

/**
 * Batch update tags on multiple tasks (board-scoped storage)
 * Performs a single read-modify-write cycle to avoid race conditions
 */
export async function batchUpdateTags(
  storage: Storage,
  auth: AuthContext,
  input: {
    boardId: string;
    updates: Array<{ taskId: string; tag: string | null }>;
  }
): Promise<{ ok: boolean; message: string; updated: number }> {
  return withTaskOperation(storage, auth, input.boardId, (tasks, stats, timestamp) => {
    // Apply all updates in one pass
    let updatedCount = 0;
    const updatedTasksList = tasks.tasks.map(task => {
      const update = input.updates.find(u => u.taskId === task.id);
      if (update) {
        updatedCount++;
        return {
          ...task,
          tag: update.tag || undefined,
          updatedAt: timestamp
        };
      }
      return task;
    });
    
    const updatedTasksFile: TasksFile = {
      ...tasks,
      tasks: updatedTasksList,
      updatedAt: timestamp
    };
    
    // Collect all edited tasks for stats
    const statsEvents = updatedTasksList
      .filter(task => input.updates.find(u => u.taskId === task.id))
      .map(task => ({ task, eventType: 'edited' as const }));
    
    return {
      updatedTasks: updatedTasksFile,
      statsEvents,
      result: {
        ok: true,
        message: `Updated ${updatedCount} task(s) on board ${input.boardId}`,
        updated: updatedCount
      }
    };
  });
}

/**
 * Batch move tasks from one board to another (board-scoped storage)
 * Performs read-modify-write on both boards to avoid race conditions
 * Note: Preserves task IDs and createdAt timestamps across board moves
 * Moving tasks = completing them on source board + creating them on target board (with same IDs)
 */
export async function batchMoveTasks(
  storage: Storage,
  auth: AuthContext,
  input: {
    sourceBoardId: string;
    targetBoardId: string;
    taskIds: string[];
  }
): Promise<{ ok: boolean; message: string; moved: number }> {
  const timestamp = now();
  
  // Load source and target board data
  const [sourceTasks, sourceStats, targetTasks, targetStats] = await Promise.all([
    storage.getTasks(auth.userType, auth.sessionId, input.sourceBoardId),
    storage.getStats(auth.userType, auth.sessionId, input.sourceBoardId),
    storage.getTasks(auth.userType, auth.sessionId, input.targetBoardId),
    storage.getStats(auth.userType, auth.sessionId, input.targetBoardId)
  ]);
  
  // Extract tasks to move from source board
  const { tasksToExtract: tasksToMove, remainingTasks } = extractTasksFromBoard(
    sourceTasks.tasks,
    input.taskIds
  );
  
  if (tasksToMove.length === 0) {
    return { ok: true, message: 'No tasks to move', moved: 0 };
  }
  
  // Prepare tasks for target board (preserves IDs, timestamps, etc.)
  const preparedTasks = prepareTasksForBoard(tasksToMove, timestamp);
  
  // Update task files
  const updatedSourceTasksFile: TasksFile = {
    ...sourceTasks,
    tasks: remainingTasks,
    updatedAt: timestamp
  };
  
  const updatedTargetTasksFile: TasksFile = {
    ...targetTasks,
    tasks: [...preparedTasks, ...targetTasks.tasks],
    updatedAt: timestamp
  };
  
  // Update stats for both boards
  const { updatedSourceStats, updatedTargetStats } = updateBatchMoveStats(
    sourceStats,
    targetStats,
    tasksToMove,
    preparedTasks,
    timestamp
  );
  
  // Save all changes atomically per board
  await Promise.all([
    storage.saveTasks(auth.userType, auth.sessionId, input.sourceBoardId, updatedSourceTasksFile),
    storage.saveStats(auth.userType, auth.sessionId, input.sourceBoardId, updatedSourceStats),
    storage.saveTasks(auth.userType, auth.sessionId, input.targetBoardId, updatedTargetTasksFile),
    storage.saveStats(auth.userType, auth.sessionId, input.targetBoardId, updatedTargetStats)
  ]);
  
  return {
    ok: true,
    message: `Moved ${tasksToMove.length} task(s) from ${input.sourceBoardId} to ${input.targetBoardId}`,
    moved: tasksToMove.length
  };
}

/**
 * Batch clear a tag from multiple tasks and remove the tag from the board (board-scoped storage)
 * Performs a single read-modify-write cycle to avoid race conditions
 */
export async function batchClearTag(
  storage: Storage,
  auth: AuthContext,
  input: {
    boardId: string;
    tag: string;
    taskIds: string[];
  }
): Promise<{ ok: boolean; message: string; cleared: number }> {
  // First, clear tag from tasks using task operation pattern
  const taskResult = await withTaskOperation(storage, auth, input.boardId, (tasks, stats, timestamp) => {
    // Clear tag from tasks
    let clearedCount = 0;
    const updatedTasksList = tasks.tasks.map(task => {
      if (input.taskIds.includes(task.id) && task.tag) {
        const existingTags = task.tag.split(' ').filter(Boolean);
        const updatedTags = existingTags.filter(t => t !== input.tag);
        clearedCount++;
        return {
          ...task,
          tag: updatedTags.length > 0 ? updatedTags.join(' ') : undefined,
          updatedAt: timestamp
        };
      }
      return task;
    });
    
    const updatedTasksFile: TasksFile = {
      ...tasks,
      tasks: updatedTasksList,
      updatedAt: timestamp
    };
    
    // Collect edited tasks for stats
    const statsEvents = updatedTasksList
      .filter(task => input.taskIds.includes(task.id))
      .map(task => ({ task, eventType: 'edited' as const }));
    
    return {
      updatedTasks: updatedTasksFile,
      statsEvents,
      result: { clearedCount }
    };
  });
  
  // Then, remove tag from board metadata using board operation pattern
  await withBoardOperation(storage, auth, (boards, timestamp) => {
    const { board, index: boardIndex } = findBoardOrThrow(boards, input.boardId);
    const existingBoardTags = board.tags || [];
    const updatedBoard = {
      ...board,
      tags: existingBoardTags.filter(t => t !== input.tag)
    };
    
    return {
      updatedBoards: updateBoardAtIndex(boards, boardIndex, updatedBoard, timestamp),
      result: { ok: true }
    };
  });
  
  return {
    ok: true,
    message: `Cleared tag ${input.tag} from ${taskResult.clearedCount} task(s) on board ${input.boardId}`,
    cleared: taskResult.clearedCount
  };
}
