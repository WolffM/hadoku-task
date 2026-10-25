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
 * isolated for free. USER-scoped values (displayName) are shared across
 * the run; a spec that writes one must not assume it starts unset.
 */
import { randomUUID } from 'node:crypto'
import type { APIRequestContext, Page } from '@playwright/test'

/** Where scripts/dev-api.mjs serves the real prefs worker (DEV_PREFS_PORT moves it). */
export const PREFS_BASE = `http://localhost:${process.env.DEV_PREFS_PORT ?? 3003}/prefs`

/**
 * Is the real prefs stack up? Specs skip on false, the same way the ones
 * needing :3001 do — both come up together with `pnpm run dev:api`.
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

/** The task row's endpoint on the local prefs-api. */
const TASK_PREFS = `${PREFS_BASE}/api/v1/task`

/**
 * The SDK's localStorage cache of the task row: `prefs-cache:{userId}:{appId}`.
 * The local whoami shim answers `dev-uid` for every caller.
 */
export const TASK_PREFS_CACHE_KEY = 'prefs-cache:dev-uid:task'

/**
 * Give this page a device whose saved prefs already hold `prefs` — the state a
 * returning user's browser is in.
 *
 * Seeds both halves the SDK reads: the device row on the real prefs-api
 * (written exactly as the SDK's own save() writes a device-scoped patch), and
 * the SDK's localStorage cache of it, under the planted `hadoku_device_id`.
 *
 * Both, because the browser cannot currently reach the local prefs-api at all:
 * its CORS list carries `http://localhost:*` as a literal string, hono's array
 * matcher compares origins exactly, so every preflight from vite's origin fails
 * and the SDK runs on its cache. Seeding only the server would test defaults;
 * seeding only the cache would break the day that CORS is fixed, because the
 * SDK refreshes the cache from the server.
 *
 * Register it AFTER any init script that clears localStorage (signIn does):
 * init scripts run in registration order. It seeds once per empty storage, so a
 * reload keeps what the previous load left.
 */
export async function seedDevicePrefs(page: Page, prefs: Record<string, unknown>): Promise<string> {
  const deviceId = randomUUID()
  const resp = await page.request.put(TASK_PREFS, {
    headers: { 'X-Device-Id': deviceId },
    data: { scope: 'device', patch: prefs, expectedVersion: 0 }
  })
  if (!resp.ok()) {
    throw new Error(`seeding device prefs failed: ${resp.status()} ${await resp.text()}`)
  }
  const { version } = (await resp.json()) as { version: number }
  await page.addInitScript(
    ({ id, key, envelope }) => {
      // Only into an empty slot: init scripts re-run on every navigation, and
      // re-seeding on a reload would paper over whatever the last load wrote.
      if (window.localStorage.getItem('hadoku_device_id') === null) {
        window.localStorage.setItem('hadoku_device_id', id)
        window.localStorage.setItem(key, envelope)
      }
    },
    {
      id: deviceId,
      key: TASK_PREFS_CACHE_KEY,
      envelope: JSON.stringify({
        blob: prefs,
        userVersion: 0,
        deviceVersion: version,
        cachedAt: Date.now()
      })
    }
  )
  return deviceId
}

/** The task-row blob the SDK holds for this page (its localStorage cache). */
export function readTaskPrefsCache(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(key => {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw).blob as Record<string, unknown>) : null
  }, TASK_PREFS_CACHE_KEY)
}
