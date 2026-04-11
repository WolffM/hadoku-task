/**
 * Shared type definitions for the Task API Worker
 */
import type { HadokuAuthContext } from '@wolffm/worker-utils'

export interface Env {
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
