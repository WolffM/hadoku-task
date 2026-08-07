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
 *
 * WHEN THESE RUN
 * --------------
 * Everything the popout displays is resolved at PAGE LOAD, not on gear-click —
 * see `prefetchSettings()`. Opening settings must cost zero requests. Pinned by
 * `e2e/settings-prefetch.spec.ts` in hadoku-task.
 */

/** Edge-router / prefs-api endpoints (same-origin relative). */
const CONTENT_LEVEL_PATH = '/prefs/api/v1/content-level'
const SESSION_NAME = '/session/name'
const SESSION_CREATE = '/session/create'
const SESSION_WHOAMI = '/session/whoami'

/**
 * The ecosystem's shared boot-whoami promise. hadoku_site's `mf-loader.js`
 * kicks `GET /session/whoami` in parallel with the micro-frontend's module
 * import and parks the promise here precisely so the app it loads doesn't
 * resolve identity a second time; @wolffm/prefs-client already consumes it
 * under the same name. Reading it is what makes settings' identity free.
 *
 * Absent outside that shell (standalone vite, Capacitor, Storybook) — there we
 * fetch, and publish the result under the same key so the next reader is free
 * too.
 */
const WHOAMI_GLOBAL = '__hadokuWhoami'

/**
 * Raw whoami body, as both mf-loader and this module see it off the wire.
 *
 * `contentLevel` / `maxContentLevel` are OPTIONAL because the shape is
 * versioned by whatever edge-router is deployed, not by this bundle. They
 * arrive from edge-router ≥ the 2026-08-07 change, which reports the level
 * `authGate` had already resolved to stamp X-Hadoku-Content-Level. When they
 * are absent we fall back to the standalone GET — see resolveSettings.
 */
interface WhoamiBody {
  valid?: boolean
  userType?: Tier
  name?: string | null
  contentLevel?: number
  maxContentLevel?: number
}

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
    const stored = (await res.json()) as ContentLevelState
    patchSnapshot(prev => ({ ...prev, content: stored }))
    return stored
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
    patchSnapshot(prev => ({ ...prev, identity: { ...prev.identity, name: body.name } }))
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
 * The page's one whoami body, resolved at most once no matter how many callers.
 *
 * Under the hadoku.me shell this costs NO request: mf-loader kicks whoami in
 * parallel with the micro-frontend's module import and parks the promise on
 * WHOAMI_GLOBAL for exactly this reason (@wolffm/prefs-client reads the same
 * key). Elsewhere — standalone vite, Capacitor, Storybook — we fetch once and
 * publish under the same key so the next reader is free too.
 *
 * Resolves to null rather than throwing on any failure.
 */
function sharedWhoami(): Promise<WhoamiBody | null> {
  const g = globalThis as { [WHOAMI_GLOBAL]?: Promise<WhoamiBody | null> }
  g[WHOAMI_GLOBAL] ??= fetch(SESSION_WHOAMI, {
    credentials: 'same-origin',
    headers: sessionHeaders(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
    .then(res => (res.ok ? (res.json() as Promise<WhoamiBody>) : null))
    .catch(() => null)
  return g[WHOAMI_GLOBAL]
}

/**
 * Resolve the signed-in caller's tier + display name from the edge-router.
 * Returns { userType: 'public', name: null } for anonymous / off-origin / any
 * failure — never throws, so ConnectedSettings can render unconditionally.
 */
export async function whoami(): Promise<Identity> {
  if (typeof window === 'undefined') return { userType: 'public', name: null }
  try {
    const body = await sharedWhoami()
    if (!body?.valid) return { userType: 'public', name: null }
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

/* ------------------------------------------------------------------ *
 * Prefetch
 * ------------------------------------------------------------------ */

/** Everything the settings popout displays, resolved together. */
export interface SettingsSnapshot {
  identity: Identity
  /** null = public caller (no pill) or the request failed. */
  content: ContentLevelState | null
}

/** Identity the host already knows, so we don't ask the server for it again. */
export interface SettingsPrefetchHints {
  /** Caller's tier. When supplied, whoami is skipped entirely. */
  userType?: Tier
  /** Caller's display name. Only meaningful alongside `userType`. */
  name?: string | null
}

let snapshot: Promise<SettingsSnapshot> | null = null

/**
 * Resolve — once per page load — everything the settings popout shows.
 *
 * This is THE entry point, and it is called from ConnectedSettings' MOUNT, not
 * from its open handler. Settings data is user identity: it is known at boot,
 * it doesn't change while the page is up, and making the gear the trigger left
 * the panel on screen but blank for a round trip (measured on prod: whoami
 * 167ms and content-level 186ms, issued concurrently). It now rides along with
 * the app's own boot traffic and the click costs nothing.
 *
 * Idempotent and shared: every caller after the first gets the same promise, so
 * N mounted consumers still produce at most one whoami for the whole page.
 * Mutations below write through to it rather than invalidating, so a remount
 * never shows a value the user just changed.
 *
 * Against a current edge-router this issues NO requests of its own at all — the
 * level rides on the whoami the shell already had in flight. See
 * resolveSettings for the fallback when it doesn't.
 */
export function prefetchSettings(hints: SettingsPrefetchHints = {}): Promise<SettingsSnapshot> {
  snapshot ??= resolveSettings(hints)
  return snapshot
}

async function resolveSettings(hints: SettingsPrefetchHints): Promise<SettingsSnapshot> {
  // The whoami body, not just the adapted identity — edge-router carries the
  // content level on it (see below), and reading the raw body is how we get at
  // it without a second request.
  //
  // Skipped entirely when the host supplied identity: that prop exists for apps
  // that CANNOT reach /session/whoami (conjure sits behind a path-prefixed shim
  // where it 404s), so asking anyway would spend a request to learn nothing.
  const selfResolving = hints.userType === undefined && typeof window !== 'undefined'
  const bodyPromise = selfResolving ? sharedWhoami() : Promise.resolve(null)

  const identityPromise: Promise<Identity> =
    hints.userType !== undefined
      ? Promise.resolve({ userType: hints.userType, name: hints.name ?? null })
      : whoami()

  // PREFERRED PATH: take the level straight off whoami.
  //
  // edge-router's authGate has already resolved it (registry key → userId →
  // prefs D1) to stamp X-Hadoku-Content-Level, so reporting it on whoami costs
  // it nothing — and it saves us a proxied round trip to prefs-api that
  // measured 132-420ms against prod. Better still, whoami is in flight before
  // this bundle has even loaded, so the value is here the moment we ask.
  //
  // FALLBACK: the standalone GET, for any edge-router older than the
  // 2026-08-07 change, and for callers not behind it at all (Capacitor,
  // Storybook, a non-hadoku host). Gated on identity because the pill is
  // hidden for public callers — fetching an anonymous visitor's level is a
  // guaranteed-wasted request on every page view. `hadoku_user_type` is
  // written by the loader before anything mounts, so where it already says
  // "signed in" the fallback goes out concurrently rather than behind whoami.
  const contentPromise = bodyPromise.then(body => {
    const carried = contentFromWhoami(body)
    if (carried) return carried
    if (looksSignedIn(hints.userType)) return getContentLevel()
    return identityPromise.then(id => (id.userType === 'public' ? null : getContentLevel()))
  })

  const [identity, content] = await Promise.all([identityPromise, contentPromise])
  return { identity, content }
}

/**
 * Adapt the content level off a whoami body, or null if that edge-router
 * doesn't report it.
 *
 * Both fields are required, and both must be numbers: a body carrying a level
 * without its ceiling would render a pill with zero segments — worse than the
 * fallback fetch, because it looks like a working control that offers nothing.
 */
function contentFromWhoami(body: WhoamiBody | null): ContentLevelState | null {
  if (!body?.valid) return null
  const { contentLevel, maxContentLevel } = body
  if (typeof contentLevel !== 'number' || typeof maxContentLevel !== 'number') return null
  if (maxContentLevel < 1) return null
  return { level: contentLevel, maxLevel: maxContentLevel }
}

/** Best-effort "is this caller signed in?" from state available synchronously. */
function looksSignedIn(hinted?: Tier): boolean {
  if (hinted !== undefined) return hinted !== 'public'
  if (typeof window === 'undefined') return false
  const cached = localStorage.getItem('hadoku_user_type')
  return cached !== null && cached !== 'public'
}

/** Keep the prefetched snapshot in step with a successful mutation. */
function patchSnapshot(patch: (prev: SettingsSnapshot) => SettingsSnapshot) {
  if (!snapshot) return
  snapshot = snapshot.then(patch)
}
