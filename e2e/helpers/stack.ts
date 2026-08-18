import type { APIRequestContext, Page } from '@playwright/test'

/**
 * Shared plumbing for every spec that talks to the local dev stack
 * (`pnpm run dev:api`).
 *
 * These three pieces were copy-pasted verbatim into thirteen specs. They are
 * not incidental repetition: they encode one contract each — where the worker
 * listens, how the app is told who you are, and what "the stack is up" means —
 * and thirteen copies is thirteen places to miss when any of those change.
 */

/** The REAL worker on :3001, behind the edge-router shim (see scripts/dev-api.mjs). */
export const API = 'http://127.0.0.1:3001/task/api'

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
 * Is the local API stack up? Server-path specs skip themselves when it isn't,
 * because CI never runs Playwright and a developer without the stack should get
 * a skip, not a wall of connection errors.
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
