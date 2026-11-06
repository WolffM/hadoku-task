/**
 * Who gets server storage (#107).
 *
 * A board or task row is owned by a registry userId, and only the edge can
 * vouch for one. Before this, a caller with no identity fell through to the
 * shared literal `'public'` (DEFAULT_SESSION_ID): every anonymous caller — and
 * every member, whom the edge sends on as anonymous outside routes opened to
 * them — read and wrote ONE bucket, which no account erase could ever reach.
 *
 * The rule, the member model's:
 *   - friend and up: storage, as before. The operator handed out the key.
 *   - a VERIFIED member (`X-Hadoku-Verified: 1`: a spare the operator made, or
 *     a member verified on the Members page): storage, exactly as a friend.
 *   - an unverified member, or anyone with no edge-stamped userId: none. The
 *     app runs them local-only (src/app/entry.tsx), as it always ran public.
 *
 * Kept import-light: root runs it on every storage request, cold isolates too.
 */
import { tierAtLeast } from '@wolffm/worker-utils'
import type { AppContext } from './types'

type Auth = AppContext['Variables']['authContext']

export interface StorageRefusal {
  status: 401 | 403
  body: { error: string; code: 'IDENTITY_REQUIRED' | 'MEMBER_NOT_VERIFIED'; message: string }
}

export function hasStorage(auth: Auth | undefined): boolean {
  return storageRefusal(auth) === null
}

export function storageRefusal(auth: Auth | undefined): StorageRefusal | null {
  // Below member there is no person to store for, whatever headers arrived.
  if (!auth?.userId || !tierAtLeast(auth, 'member')) {
    return {
      status: 401,
      body: {
        error: 'Unauthorized',
        code: 'IDENTITY_REQUIRED',
        message: 'Sign in to store boards and tasks; without an account they stay on this device.'
      }
    }
  }
  if (tierAtLeast(auth, 'friend')) return null
  if (auth.userType === 'member' && auth.verified === true) return null
  return {
    status: 403,
    body: {
      error: 'Forbidden',
      code: 'MEMBER_NOT_VERIFIED',
      message:
        'Boards and tasks are stored for verified members; until then they stay on this device.'
    }
  }
}
