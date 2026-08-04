/**
 * Client for the unified user-settings modal (ConnectedSettings).
 *
 * Three concerns, all cookie-authed against the hadoku.me edge-router, which
 * resolves the `hadoku_session` cookie / `X-Session-Id` header → X-User-Key +
 * X-User-Id for the backend:
 *   - display name  → POST /session/name                   (edge-router, self rename)
 *   - content level → GET/PUT /prefs/api/v1/content-level  (prefs-api)
 *   - auth key swap → POST /session/create                 (edge-router, new session)
 *
 * These are same-origin relative paths, so ConnectedSettings is portable to any
 * app served under hadoku.me with zero wiring. Off-origin (e.g. a Storybook or
 * a non-hadoku host) every call resolves to null and the UI degrades to a
 * read-only shell — it never throws.
 *
 * The raw key is never held in the browser (the auth page deliberately drops
 * it), so name + content-level changes go through session identity, not a key
 * header. Only an explicit key SWAP re-presents a key — the new one the user
 * types.
 */

/** Edge-router / prefs-api endpoints (same-origin relative). */
const CONTENT_LEVEL_PATH = '/prefs/api/v1/content-level'
const SESSION_NAME = '/session/name'
const SESSION_CREATE = '/session/create'
const SESSION_WHOAMI = '/session/whoami'

// Hard timeout on every settings request. Without it, a request throttled by
// the browser (e.g. the tab going to the background) leaves the caller's
// "saving" flag stuck true — which disabled the content-level pills until the
// tab regained focus. AbortSignal.timeout guarantees the promise settles.
const REQUEST_TIMEOUT_MS = 8000

/** Session-id header the same way whoami() sends it (cookie is the fallback). */
function sessionHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
  const sid = typeof window !== 'undefined' ? localStorage.getItem('hadoku_session_id') : null
  if (sid) headers['X-Session-Id'] = sid
  return headers
}

export interface ContentLevelState {
  /** Current global content-visibility level (1 = safest default). */
  level: number
  /** Highest level this caller's tier may select (friend=3, admin=4). */
  maxLevel: number
}

/** GET the caller's current content level + tier ceiling. null on error. */
export async function getContentLevel(): Promise<ContentLevelState | null> {
  try {
    const res = await fetch(CONTENT_LEVEL_PATH, {
      credentials: 'same-origin',
      headers: sessionHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) return null
    return (await res.json()) as ContentLevelState
  } catch {
    return null
  }
}

/** PUT a new content level. Server clamps to the tier ceiling → 400 if out of
 *  range. Returns the stored state on success, null on any failure. */
export async function setContentLevel(level: number): Promise<ContentLevelState | null> {
  try {
    const res = await fetch(CONTENT_LEVEL_PATH, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: sessionHeaders(),
      body: JSON.stringify({ level }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) return null
    return (await res.json()) as ContentLevelState
  } catch {
    return null
  }
}

/** POST a new display name for the signed-in user. Returns the stored name
 *  (may differ from the request for wp-* protected keys) or null on failure. */
export async function setDisplayName(name: string): Promise<string | null> {
  try {
    const res = await fetch(SESSION_NAME, {
      method: 'POST',
      credentials: 'same-origin',
      headers: sessionHeaders(),
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) return null
    const body = (await res.json()) as { ok: boolean; name: string | null }
    return body.name
  } catch {
    return null
  }
}

/**
 * The hadoku tier ladder, LOW to HIGH: `public < friend < service < wife < admin`.
 * Mirrors TIER_RANK in @wolffm/worker-utils, which this browser bundle cannot
 * import (it would pull hono into the client). A tier missing here does not
 * error — it fails the union and, worse, drops out of every `Record<Tier, …>`
 * lookup, so the caller renders as if unrecognised. Keep it complete.
 */
export type Tier = 'public' | 'friend' | 'service' | 'wife' | 'admin'

export interface Identity {
  userType: Tier
  name: string | null
}

/**
 * Resolve the signed-in caller's tier + display name from the edge-router.
 * Returns { userType: 'public', name: null } for anonymous / off-origin / any
 * failure — never throws, so ConnectedSettings can render unconditionally.
 */
export async function whoami(): Promise<Identity> {
  if (typeof window === 'undefined') return { userType: 'public', name: null }
  try {
    const res = await fetch(SESSION_WHOAMI, {
      credentials: 'same-origin',
      headers: sessionHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) return { userType: 'public', name: null }
    const body = (await res.json()) as { valid?: boolean; userType?: Tier; name?: string | null }
    if (!body.valid) return { userType: 'public', name: null }
    return { userType: body.userType ?? 'public', name: body.name ?? null }
  } catch {
    return { userType: 'public', name: null }
  }
}

export interface KeySwapResult {
  userType: Tier
  name: string | null
}

/**
 * Swap the active auth key. POSTs the new key to /session/create, which mints
 * a FRESH session (new sessionId + cookie) — so on success we rewrite the
 * localStorage session mirror the rest of the app reads. Caller is expected to
 * reload afterwards so every mounted surface re-reads identity. Returns the new
 * tier on success, null on an invalid key / failure.
 */
export async function swapAuthKey(newKey: string): Promise<KeySwapResult | null> {
  try {
    const res = await fetch(SESSION_CREATE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-User-Key': newKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!res.ok) return null
    const body = (await res.json()) as {
      valid: boolean
      sessionId?: string
      userType: Tier
      name: string | null
    }
    if (!body.valid || !body.sessionId) return null
    localStorage.setItem('hadoku_session_id', body.sessionId)
    localStorage.setItem('hadoku_user_type', body.userType)
    return { userType: body.userType, name: body.name }
  } catch {
    return null
  }
}
