import type { APIRequestContext, Page } from '@playwright/test'
import { stackPort } from './ports'

/**
 * Shared plumbing for every spec that talks to the local dev stack
 * (scripts/dev-api.mjs, which playwright.config.ts starts).
 *
 * These three pieces were copy-pasted verbatim into thirteen specs. They are
 * not incidental repetition: they encode one contract each — where the worker
 * listens, how the app is told who you are, and what "the stack is up" means —
 * and thirteen copies is thirteen places to miss when any of those change.
 */

/** The REAL worker on this run's DEV_API_PORT, behind the edge-router shim (see
 * scripts/dev-api.mjs). */
export const API = `http://127.0.0.1:${stackPort('DEV_API_PORT')}/task/api`

/**
 * Sign in the way the key-swap flow does: the app reads these on boot.
 *
 * `addInitScript`, not an `evaluate` after `goto` — the read happens during the
 * app's own boot, so seeding it afterwards is already too late.
 */
export async function signIn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('hadoku_session_id', 'dev-uid')
    localStorage.setItem('hadoku_user_type', 'friend')
  })
}

/**
 * Is the local API stack up? playwright.config.ts starts it, so it normally
 * is; server-path specs still skip themselves when it isn't, and CI fails a
 * skip e2e.json's e2eSkipAllow does not name.
 *
 * `headers` is for the specs that must probe as a specific user key.
 */
export async function apiUp(
  request: APIRequestContext,
  headers?: Record<string, string>
): Promise<boolean> {
  try {
    return (await request.get(`${API}/automation/presets`, headers ? { headers } : {})).ok()
  } catch {
    return false
  }
}
