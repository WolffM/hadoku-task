/**
 * Shared type definitions for the Task API Worker
 */
import type { HadokuAuthContext } from '@wolffm/worker-utils'

export interface Env {
  // Edge provenance secret — createEdgeAuth verifies inbound X-Edge-Auth.
  EDGE_AUTH_SECRET?: string
  TASKS_KV: KVNamespace
  DB: D1Database
  // Read-only key registry (§7.3). edge-router owns `key:{rawKey}` →
  // { userId, name, tier }; task-api binds the same SESSIONS_KV namespace to
  // resolve a grantee key → userId when granting a board share. Same pattern as
  // prefs-api. Optional so local/dev without the binding still boots (grant-by-key
  // then returns a clear error; grant-by-userId still works).
  SESSIONS_KV?: KVNamespace
  // THE GitHub PAT — the worker's single GitHub credential, resolved from the
  // HADOKU_SITE_TOKEN vault key. Read `githubToken(env)` rather than this field:
  // one accessor, so there is one answer to "which credential does GitHub see".
  //
  // Two uses, and the name undersells the second: validating a board's `repo`
  // (private WolffM repos 404 unauthenticated, so a real check needs a token) and
  // the outbound `repository_dispatch` that wakes an automation board's runner
  // (§5.2) — a WRITE, which needs `repo` scope. It is deliberately NOT split into
  // a second binding: the value would be identical, and a duplicate secret to
  // keep in sync buys nothing until there is a genuinely narrower token to put in
  // one of them. Split it then, at this one accessor.
  //
  // Optional. Absent ⇒ repo validation degrades to an unauthenticated probe
  // (public repos only) and no dispatch is sent; board writes are unaffected.
  GITHUB_READ_TOKEN?: string
  // Registry display name of the automation runner that gets `contributor` on a
  // board automatically when it's activated as an automation board (§5.4, §7).
  // Defaults to 'tenhands-service-key' — the app identity TenHands' worker
  // presents. A binding only because that name has been retired and re-minted
  // before; a rename shouldn't need a deploy here to keep auto-sharing working.
  AUTOMATION_RUNNER_KEY_NAME?: string
  // Automation preset providers (§5.4): a JSON array of {id,label,url}, e.g.
  // [{"id":"tenhands","label":"TenHands","url":"https://…/automation/presets"}].
  // Each URL is fetched server-side for the lane contracts the activation UI
  // offers. https only. Absent ⇒ no preset picker, paste-JSON still works.
  AUTOMATION_PRESET_SOURCES?: string
  // This worker's OWN identity at TenHands, sent as X-User-Key when scanning a
  // board's repo for open issues/PRs (GET /boards/{ref}/actionable, §5.6).
  // TenHands gates every non-public path on a registry key; presets are exempt
  // (a lane vocabulary is public), an issue list is not.
  //
  // Ours, never the caller's: forwarding a person's credential to another origin
  // hands that origin the ability to act as them. Same pattern contact-api uses
  // to reach task-api (CONTACTUI_SERVICE_KEY).
  //
  // Absent ⇒ the scan reports `no_service_key` and the "Automate open items"
  // button never appears. Nothing else degrades.
  TENHANDS_SERVICE_KEY?: string
  // WHERE the automation runner's workflow lives, e.g. 'WolffM/tenhands' — the
  // target of the `repository_dispatch` that wakes it (§5.2). NOT the board's
  // own `repo`: the runner is ONE workflow in ONE repo that sweeps every board
  // shared with it, so for every board except the runner's own, those two are
  // different repos. Dispatching to the board's repo instead reaches a repo with
  // nothing listening for `taskauto`, and GitHub drops it without a trace.
  // Read `runnerRepo(env)`, never this field. Absent ⇒ falls back to the board's
  // `repo`, which is correct only when the board's repo IS the runner's.
  AUTOMATION_RUNNER_REPO?: string
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
