/**
 * Where the prefs SDK should talk to.
 *
 * @wolffm/prefs-client defaults to `https://hadoku.me/prefs`, which is correct
 * everywhere except a local dev or E2E run — there it means the browser reaches
 * PRODUCTION for every preference read and write.
 *
 * That default is why the theme specs mocked `/prefs/api/v1/*` at the network
 * layer in the first place, and the mocks then hid a real bug: the shared row's
 * request escaped to hadoku.me unrouted, where a row that FAILS to resolve is
 * indistinguishable from an empty one, so `useThemePrefsMigration` looked fine
 * under test while being permanently disabled in the field.
 *
 * An override lets the dev stack run the REAL prefs-api worker locally and point
 * the SDK at it, so the specs exercise the true fetch → auth → D1 path instead of
 * an interceptor's idea of it. Route mocking is what we are removing; this is the
 * seam that makes removing it possible.
 *
 * Set it before app code runs — a Playwright `addInitScript`, or an inline
 * <head> script in a dev shell:
 *
 *   window.__HADOKU_PREFS_API_BASE__ = 'http://localhost:3003/prefs'
 *
 * Unset (the normal case, including all of production) returns undefined, and
 * every client falls through to the SDK's own default.
 */

/** The global the override is read from. Exported so callers agree on the name. */
export const PREFS_API_BASE_GLOBAL = '__HADOKU_PREFS_API_BASE__'

/**
 * The prefs API base to use, or undefined to accept the SDK's default.
 *
 * Deliberately returns `undefined` rather than the production URL: passing
 * `apiBase: undefined` to createPrefsClient lets its own `?? PREFS_API_BASE`
 * default apply, so this module never has to restate — and never drifts from —
 * whatever the SDK considers canonical.
 */
export function resolvePrefsApiBase(): string | undefined {
  const override = (globalThis as Record<string, unknown>)[PREFS_API_BASE_GLOBAL]
  return typeof override === 'string' && override.length > 0 ? override : undefined
}
