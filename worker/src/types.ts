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
}

/**
 * Extended auth context for task-api
 *
 * Extends HadokuAuthContext with:
 * - sessionId: Used as KV storage key prefix (actually the credential, not browser session)
 * - key: Alias for credential (backward compat for throttle middleware)
 */
export interface TaskAuthExtension {
  sessionId: string
  key: string | undefined
  [key: string]: unknown
}

export interface AppContext {
  Bindings: Env
  Variables: {
    authContext: HadokuAuthContext & TaskAuthExtension
  }
}
