import { logger } from '@wolffm/logger/client'
import type { UserType } from '../domain/types'

/**
 * Generate a unique session ID for this browser tab/session
 * Used to identify which tab made changes when coordinating cross-tab sync via BroadcastChannel
 */
export const SESSION_ID = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

/**
 * The authed sessionId the host page stored. hadoku_site's mf-loader owns this
 * key: it syncs it from /session/whoami on every boot.
 */
export function getStoredSessionId(): string | null {
  return localStorage.getItem('hadoku_session_id')
}

/**
 * Anon-session storage key.
 *
 * DELIBERATELY NOT `hadoku_session_id`: the host page's micro-frontend loader
 * (hadoku_site mf-loader.js) OWNS `hadoku_session_id` and wipes it on every boot
 * when the server says the user is public — it treats any stored value as a
 * stale *auth* session. Our anon local session is a different thing, so it needs
 * a key the host never touches; otherwise the host wipes it, we re-mint a fresh
 * id, and every reload strands the previous anon user's tasks.
 */
const ANON_SESSION_KEY = 'task_anon_session_id'

/**
 * The stable per-browser anon (public-user) sessionId. Minted once and reused
 * across reloads, so an unauthenticated user's local tasks survive a reload.
 */
export function getAnonSessionId(): string {
  let id = localStorage.getItem(ANON_SESSION_KEY)
  if (!id) {
    id = `public-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    localStorage.setItem(ANON_SESSION_KEY, id)
    logger.info('[Session] Minted anon sessionId', { id })
  }
  return id
}

/**
 * The tier the host page stored alongside the sessionId (mf-loader, from
 * whoami). Read-only here: the edge owns identity, so the app never writes it.
 */
export function getStoredUserType(): UserType | null {
  return localStorage.getItem('hadoku_user_type') as UserType | null
}
