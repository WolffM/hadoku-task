/**
 * Point a spec's prefs traffic at the REAL prefs-api on :3003 instead of
 * mocking it.
 *
 * WHY THERE IS NO MOCK HERE
 * -------------------------
 * These specs used to intercept `/prefs/api/v1/*` with Playwright routes, and
 * the interceptors actively hid a bug. `useThemePrefsMigration` bailed whenever
 * the shared row read back as null, and nothing caught it because only the
 * 'task' row was ever mocked — the 'portfolio' row's request escaped to the real
 * hadoku.me, where a row that FAILS to resolve is indistinguishable from an
 * empty one. The migration was permanently disabled in the field while the suite
 * stayed green.
 *
 * The mock was also just wrong about the contract. It answered 404 for an
 * unset row; the real worker answers 200 with `{user:null, device:null,
 * merged:{}}`. Nothing in the suite could have told you that.
 *
 * So: `pnpm run dev:api` runs the real prefs-api worker against a real sqlite
 * D1, and these helpers point the SDK at it. What the spec exercises is the
 * actual fetch → edge-auth → D1 path.
 *
 * ISOLATION BETWEEN TESTS
 * -----------------------
 * The stack keeps ONE database for the whole run, so device- and user-scoped
 * rows would collide across tests if they shared a key. They don't: the SDK
 * mints `hadoku_device_id` into localStorage on first use, and every Playwright
 * test gets a fresh context, so each test is a brand-new DEVICE. Device-scoped
 * prefs — theme, themeMode, everything these specs assert on — are therefore
 * isolated for free. USER-scoped values (experimentalThemes) are shared across
 * the run; a spec that writes one must not assume it starts unset.
 */
import type { APIRequestContext, Page } from '@playwright/test'

/** Where scripts/dev-api.mjs serves the real prefs worker. */
export const PREFS_BASE = 'http://localhost:3003/prefs'

/**
 * Is the real prefs stack up? Specs skip on false, the same way the ones
 * needing :3001 do — the prefs server is not started when the sibling
 * hadoku_site checkout is absent.
 */
export async function prefsUp(request: APIRequestContext): Promise<boolean> {
  try {
    return (await request.get(`${PREFS_BASE}/api/v1/_health`)).ok()
  } catch {
    return false
  }
}

/**
 * Send this page's prefs traffic to the local worker.
 *
 * Must run before app code, hence addInitScript: the prefs clients are created
 * at module scope, so they read the global as the bundle evaluates. Setting it
 * later leaves them pointed at production.
 */
export async function pointPrefsAtLocalStack(page: Page): Promise<void> {
  await page.addInitScript(base => {
    ;(window as unknown as Record<string, unknown>).__HADOKU_PREFS_API_BASE__ = base
  }, PREFS_BASE)
}
