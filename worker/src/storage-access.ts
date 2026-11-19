/**
 * Who gets server storage (#107).
 *
 * A board or task row is owned by a registry userId, and only the edge can
 * vouch for one. Before this, a caller with no identity fell through to the
 * shared literal `'public'` (DEFAULT_SESSION_ID): every anonymous caller — and
 * every member, whom the edge sends on as anonymous outside routes opened to
 * them — read and wrote ONE bucket, which no account erase could ever reach.
 *
 * The rule, the tier ladder's:
 *   - member and up: storage. The edge sends `member` only for an account the
 *     operator verified (a spare they made, or one verified on the Members
 *     page), so a member stores exactly as a friend does.
 *   - a guest (an account the visitor made, not yet verified): 403
 *     MEMBER_NOT_VERIFIED. Anyone with no edge-stamped userId: 401. Neither
 *     gets storage. The app runs them local-only (src/app/entry.tsx), as it
 *     always ran public.
 *
 * Kept import-light: root runs it on every storage request, cold isolates too.
 */
import { MEMBER_NOT_VERIFIED, tierAtLeast } from '@wolffm/worker-utils'
import type { AppContext } from './types'

type Auth = AppContext['Variables']['authContext']

export interface StorageRefusal {
  status: 401 | 403
  body: { error: string; code: 'IDENTITY_REQUIRED' | typeof MEMBER_NOT_VERIFIED; message: string }
}

export function hasStorage(auth: Auth | undefined): boolean {
  return storageRefusal(auth) === null
}

export function storageRefusal(auth: Auth | undefined): StorageRefusal | null {
  // Below guest there is no person to store for, whatever headers arrived. A
  // guest (an account the visitor made) is a person, refused below with the
  // code that tells the app verifying is all that stands in the way.
  if (!auth?.userId || !tierAtLeast(auth, 'guest')) {
    return {
      status: 401,
      body: {
        error: 'Unauthorized',
        code: 'IDENTITY_REQUIRED',
        message: 'Sign in to store boards and tasks; without an account they stay on this device.'
      }
    }
  }
  if (tierAtLeast(auth, 'member')) return null
  return {
    status: 403,
    body: {
      error: 'Forbidden',
      code: MEMBER_NOT_VERIFIED,
      message:
        'Boards and tasks are stored for verified members; until then they stay on this device.'
    }
  }
}
