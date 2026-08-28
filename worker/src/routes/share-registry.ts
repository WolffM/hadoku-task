/**
 * Board-share bookkeeping, over the SHARED identity module.
 *
 * `KeyRow`, `resolveGrantee`, `resolveRegistryName`, `readLiveRows`,
 * `registryNameMap` and `searchRegistryNames` used to live in this file. They
 * now live in `@wolffm/worker-utils/identity`, which is the single definition
 * of the registry row and the only way to turn an inbound reference into an
 * owner — see docs/architecture/IDENTITY_MODEL.md in hadoku_site.
 *
 * This file had the best-tested copy, which is why it was the one lifted. Two
 * things changed on the way:
 *
 *   - `resolveGrantee` HAS NO `userId` BRANCH ANY MORE. It used to return
 *     `{ userId: input.userId }` unlooked-up, so a caller could name any owner
 *     it liked and the registry never saw it. That is R5, it is the clause both
 *     incidents broke, and the fix is the absence of the branch rather than a
 *     check inside it: the module exports no function that returns an
 *     unresolved identifier, so there is no way to express the mistake.
 *   - the wire drops `userId` too (`GrantShareInputSchema`). Grant by `name` —
 *     the identifier a human actually has, and no credential changes hands.
 *
 * What stays here is what is genuinely task's: the share LEVEL, and turning a
 * board's grantee rows into something the UI can render.
 */
import { registryNameMap } from '@wolffm/worker-utils/identity'
import type { Env } from '../types'

// Re-exported so the ~6 call sites in this worker keep one import path for
// "who is this", and so swapping the implementation was one file's diff.
export {
  isIdentityError,
  liveRowsByName,
  readLiveRows,
  registryNameMap,
  resolveGrantee,
  resolveRegistryName,
  searchRegistryNames,
  type IdentityError,
  type IdentityResult,
  type KeyRegistryRecord,
  type ResolvedIdentity
} from '@wolffm/worker-utils/identity'

/** Shared because grants and routes both stamp rows with it. */
export const nowIso = () => new Date().toISOString()

export type Level = 'readonly' | 'contributor'

/** One grantee on a board, annotated with display name + tier for the UI. */
export interface AnnotatedShare {
  granteeUserId: string
  level: string
  createdAt: string
  name: string | null
  tier: string | null
}

/**
 * Every share this owner has granted, grouped by board id and annotated with the
 * grantee's display name + tier — ONE query plus ONE registry scan for the whole
 * board set.
 *
 * Used to hydrate `GET /boards` so the Edit Boards UI has each owned board's
 * grantees up front. It used to fetch them per board when a share panel opened,
 * which meant the grantee list appeared late (or not at all — the client's
 * listShares swallows every failure as an empty list, so a hiccup was
 * indistinguishable from "not shared with anyone").
 */
export async function annotatedSharesByBoard(
  env: Env,
  ownerId: string
): Promise<Map<string, AnnotatedShare[]>> {
  const byBoard = new Map<string, AnnotatedShare[]>()
  const db = env.DB as unknown as {
    prepare(sql: string): {
      bind(...a: unknown[]): { all<T>(): Promise<{ results: T[] }> }
    }
  }
  const { results } = await db
    .prepare(
      `SELECT board_id AS boardId, grantee_user_id AS granteeUserId, level, created_at AS createdAt
         FROM board_shares WHERE owner_user_id = ? ORDER BY created_at`
    )
    .bind(ownerId)
    .all<{ boardId: string; granteeUserId: string; level: string; createdAt: string }>()
  if (!results.length) return byBoard
  const names = await registryNameMap(env)
  for (const s of results) {
    const who = names.get(s.granteeUserId)
    const arr = byBoard.get(s.boardId) ?? []
    arr.push({
      granteeUserId: s.granteeUserId,
      level: s.level,
      createdAt: s.createdAt,
      name: who?.name ?? null,
      tier: who?.tier ?? null
    })
    byBoard.set(s.boardId, arr)
  }
  return byBoard
}
