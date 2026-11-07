/**
 * The ports this run's stack is on. playwright.config.ts picks a free one for
 * each (or keeps one you pinned) and puts it in the environment the test
 * workers inherit — so there is no default to fall back to here. A fixed
 * fallback is exactly what made a parallel job or a running `pnpm run dev:api`
 * collide with the suite (hadoku-task#114); a missing variable means this file
 * was loaded outside Playwright's config, and that should be loud.
 */
export function stackPort(name: 'DEV_API_PORT' | 'DEV_PREFS_PORT'): number {
  const raw = process.env[name]
  const port = Number(raw)
  if (!raw || !Number.isInteger(port) || port <= 0) {
    throw new Error(
      `${name} is not set — run the specs through playwright.config.ts, which picks it`
    )
  }
  return port
}
