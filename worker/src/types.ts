/**
 * Shared type definitions for the Task API Worker
 */
import type { HadokuAuthContext } from '@wolffm/worker-utils'

export interface Env {
  // Edge provenance secret — createEdgeAuth verifies inbound X-Edge-Auth.
  EDGE_AUTH_SECRET?: string
  // ADMIN_KEYS/FRIEND_KEYS no longer read inbound (createEdgeAuth replaced
  // createHadokuAuth). Kept until Step 5 prunes them from CF secrets.
  ADMIN_KEYS?: string
  FRIEND_KEYS?: string
  TASKS_KV: KVNamespace
  DB: D1Database
  // Read-only key registry (§7.3). edge-router owns `key:{rawKey}` →
  // { userId, name, tier }; task-api binds the same SESSIONS_KV namespace to
  // resolve a grantee key → userId when granting a board share. Same pattern as
  // prefs-api. Optional so local/dev without the binding still boots (grant-by-key
  // then returns a clear error; grant-by-userId still works).
  SESSIONS_KV?: KVNamespace
  // GitHub PAT (read scope) for validating a board's `repo` against the GitHub
  // API. Private WolffM repos 404 unauthenticated, so a token is needed for a
  // real check. Resolved from the HADOKU_SITE_TOKEN vault key. Optional: without
  // it, validation falls back to an unauthenticated probe (public repos only).
  GITHUB_READ_TOKEN?: string
  // Automation preset providers (§5.4): a JSON array of {id,label,url}, e.g.
  // [{"id":"tenhands","label":"TenHands","url":"https://…/automation/presets"}].
  // Each URL is fetched server-side for the lane contracts the activation UI
  // offers. https only. Absent ⇒ no preset picker, paste-JSON still works.
  AUTOMATION_PRESET_SOURCES?: string
}

/**
 * Extended auth context for task-api
 *
 * Extends HadokuAuthContext with:
 * - sessionId: Storage key prefix. Historically the raw credential; being migrated
 *   to prefer `userId` (the stable per-key UUID) so data survives key rotation.
 * - userId: Edge-injected X-User-Id (registry-derived stable UUID). Present when the
 *   request arrived through edge-router; absent on direct *.workers.dev hits.
 * - key: Alias for credential (backward compat for throttle middleware)
 */
export interface TaskAuthExtension {
  /**
   * The storage scope key. Prefers `userId` (stable across key rotation); falls
   * back to the raw credential for callers that bypass the edge (no X-User-Id).
   */
  sessionId: string
  /** Edge-injected X-User-Id — the stable per-key UUID from the registry. */
  userId?: string
  /**
   * The RAW-credential namespace this user's data used to live under, before the
   * move to userId-scoped storage. Set only when we actually flipped (i.e. a
   * userId was present). The storage layer dual-reads this and copy-forwards on a
   * hit (read-repair), so pre-migration data is never orphaned.
   */
  legacyId?: string
  /** Alias for credential (backward compat for throttle middleware). */
  key: string | undefined
  [key: string]: unknown
}

export interface AppContext {
  Bindings: Env
  Variables: {
    authContext: HadokuAuthContext & TaskAuthExtension
  }
}
