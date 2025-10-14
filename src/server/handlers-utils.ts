/**
 * Helper utilities for handlers.ts
 * Extracted common patterns to reduce duplication and improve consistency
 * 
 * NOTE: No auth checks here - handlers are pure business logic.
 * Auth should be enforced at the API boundary (express routes), not in handlers.
 */

import type {
  Task,
  TasksFile,
  Board,
  BoardsFile,
  ULID
} from './types.js';

/**
 * Find task by ID or throw error
 * @throws Error if task not found
 * @returns Task and its index in the tasks array
 */
export function findTaskOrThrow(tasks: TasksFile, taskId: ULID): { task: Task; index: number } {
  const index = tasks.tasks.findIndex(t => t.id === taskId);
  if (index < 0) {
    throw new Error('Task not found');
  }
  return { task: tasks.tasks[index], index };
}

/**
 * Find board by ID or throw error
 * @throws Error if board not found
 * @returns Board and its index in the boards array
 */
export function findBoardOrThrow(
  boards: BoardsFile,
  boardId: string
): { board: Board; index: number } {
  const index = boards.boards.findIndex(b => b.id === boardId);
  if (index < 0) {
    throw new Error(`Board ${boardId} not found`);
  }
  return { board: boards.boards[index], index };
}

/**
 * Update a board at specific index immutably
 * Creates a new BoardsFile with the updated board at the specified index
 */
export function updateBoardAtIndex(
  boards: BoardsFile,
  boardIndex: number,
  updatedBoard: Board,
  timestamp: string
): BoardsFile {
  return {
    ...boards,
    updatedAt: timestamp,
    boards: [
      ...boards.boards.slice(0, boardIndex),
      updatedBoard,
      ...boards.boards.slice(boardIndex + 1)
    ]
  };
}
