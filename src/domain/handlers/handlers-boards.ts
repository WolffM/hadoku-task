/** Board writes: create, delete, rename, and the pinned top-bar order. */
import type { Storage } from '../../server/storage.js'
import type { AuthContext, Task, Board, BoardsFile } from '../types.js'
import { findBoardOrThrow, withBoardOperation } from './handlers-utils.js'

/**
 * Create a new board
 */
export async function createBoard(
  storage: Storage,
  auth: AuthContext,
  input: { id: string; name: string },
  expectedVersion?: number
): Promise<{ ok: true; board: { id: string; name: string; tasks: Task[]; tags: string[] } }> {
  return withBoardOperation(
    storage,
    auth,
    (boards, timestamp) => {
      // Check if board already exists
      if (boards.boards.find(b => b.id === input.id)) {
        throw new Error(`Board ${input.id} already exists`)
      }

      const newBoard = {
        id: input.id,
        name: input.name,
        tasks: [],
        tags: []
      }

      const updatedBoards: BoardsFile = {
        ...boards,
        updatedAt: timestamp,
        boards: [...boards.boards, newBoard]
      }

      return {
        updatedBoards,
        result: { ok: true, board: newBoard }
      }
    },
    expectedVersion
  )
}

/**
 * Delete a board
 */
export async function deleteBoard(
  storage: Storage,
  auth: AuthContext,
  boardId: string,
  expectedVersion?: number
): Promise<{ ok: true; message: string }> {
  // Prevent deleting the main board
  if (boardId === 'main') {
    throw new Error('Cannot delete the main board')
  }

  return withBoardOperation(
    storage,
    auth,
    (boards, timestamp) => {
      // Validate board exists
      findBoardOrThrow(boards, boardId)

      const updatedBoards: BoardsFile = {
        ...boards,
        updatedAt: timestamp,
        boards: boards.boards.filter(b => b.id !== boardId)
      }

      return {
        updatedBoards,
        result: { ok: true, message: `Board ${boardId} deleted` }
      }
    },
    expectedVersion
  )
}

/**
 * Rename a board (and, in future tranches, other board metadata). Goes through
 * the board-collection OCC so a concurrent rename/reorder yields 409, not a
 * silent clobber.
 */
export async function updateBoard(
  storage: Storage,
  auth: AuthContext,
  boardId: string,
  patch: { name?: string },
  expectedVersion?: number
): Promise<{ ok: true; board: Board }> {
  return withBoardOperation(
    storage,
    auth,
    (boards, timestamp) => {
      const { board } = findBoardOrThrow(boards, boardId)
      const updated: Board = {
        ...board,
        ...(patch.name !== undefined ? { name: patch.name } : {})
      }
      const updatedBoards: BoardsFile = {
        ...boards,
        updatedAt: timestamp,
        boards: boards.boards.map(b => (b.id === boardId ? updated : b))
      }
      return { updatedBoards, result: { ok: true, board: updated } }
    },
    expectedVersion
  )
}

/**
 * Set the pinned board set and its order in one operation — this is pin, unpin
 * and reorder all at once. `orderedIds` is the exact desired top-bar order:
 * every listed board becomes pinned with position = its index; every board NOT
 * listed becomes unpinned. Goes through board-collection OCC (concurrent reorder
 * → 409). Unknown ids are ignored so a stale client can't wedge the operation.
 */
export async function setPinnedBoards(
  storage: Storage,
  auth: AuthContext,
  orderedIds: string[],
  expectedVersion?: number
): Promise<{ ok: true; boards: Board[] }> {
  return withBoardOperation(
    storage,
    auth,
    (boards, timestamp) => {
      const orderOf = new Map(orderedIds.map((id, i) => [id, i]))
      const updated = boards.boards.map(b => {
        const pos = orderOf.get(b.id)
        return { ...b, pinned: pos !== undefined, position: pos ?? 0 }
      })
      const updatedBoards: BoardsFile = {
        ...boards,
        updatedAt: timestamp,
        boards: updated
      }
      return { updatedBoards, result: { ok: true, boards: updated } }
    },
    expectedVersion
  )
}
