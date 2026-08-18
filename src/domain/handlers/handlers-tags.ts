/**
 * A board's persistent tag list.
 *
 * Both handlers are deliberately forgiving: adding a tag that exists is a
 * successful no-op that does not duplicate it, and removing one that does not
 * exist succeeds too. src/test/handlers-verify.ts pins both, because until it
 * was written nothing in the repo exercised either function.
 */
import type { Storage } from '../../server/storage.js'
import type { AuthContext } from '../types.js'
import { withBoardOperation, modifyBoardTags } from './handlers-utils.js'

/**
 * Add a tag to a board
 */
export async function createTag(
  storage: Storage,
  auth: AuthContext,
  input: { boardId: string; tag: string }
): Promise<{ ok: true; message: string }> {
  return withBoardOperation(storage, auth, (boards, timestamp) => {
    const { updatedBoards, modified } = modifyBoardTags(
      boards,
      input.boardId,
      (tags, tag) => [...tags, tag],
      input.tag,
      timestamp,
      { skipIfExists: true }
    )

    return {
      updatedBoards,
      result: {
        ok: true,
        message: modified
          ? `Tag ${input.tag} added to board ${input.boardId}`
          : `Tag ${input.tag} already exists`
      }
    }
  })
}

/**
 * Remove a tag from a board
 */
export async function deleteTag(
  storage: Storage,
  auth: AuthContext,
  input: { boardId: string; tag: string }
): Promise<{ ok: true; message: string }> {
  return withBoardOperation(storage, auth, (boards, timestamp) => {
    const { updatedBoards } = modifyBoardTags(
      boards,
      input.boardId,
      (tags, tag) => tags.filter((t: string) => t !== tag),
      input.tag,
      timestamp
    )

    return {
      updatedBoards,
      result: { ok: true, message: `Tag ${input.tag} removed from board ${input.boardId}` }
    }
  })
}
