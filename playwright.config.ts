import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

/**
 * EVERY PORT THIS RUN USES IS FREE, CHOSEN AT START (hadoku-task#114)
 * -------------------------------------------------------------------
 * The stack used to bind fixed ports — the task worker on :3001, the preset
 * stub on :3002, prefs-api on :3003, vite on :5199 — so a second e2e job on the
 * same host, or a developer's own `pnpm run dev:api`, failed the run with
 * EADDRINUSE (run 41174578264). Now any of the four the environment does not
 * set gets a port the kernel hands out (scripts/free-ports.mjs), and is written
 * back to process.env:
 *
 *   - the two webServers below inherit it: dev-api.mjs binds its servers
 *     there, and vite.config.ts proxies /task/api and /prefs there;
 *   - test workers inherit it (they are spawned with this process's env, and
 *     re-loading this file in a worker finds the vars set, so they never
 *     re-pick): e2e/helpers/stack.ts and helpers/prefs.ts read it;
 *   - baseURL is built from it.
 *
 * Nothing in the test path names a fixed port, so two runs on one host cannot
 * meet — not even in the shared helpers' fallbacks, which throw instead.
 *
 * PINNING A PORT
 * --------------
 * Set the variable and that one is used. The point of doing so locally is
 * reuse: `reuseExistingServer` adopts whatever already answers, so
 *
 *   pnpm run dev:api                                   # :3001/:3002/:3003
 *   DEV_API_PORT=3001 DEV_PROVIDER_PORT=3002 DEV_PREFS_PORT=3003 \
 *     E2E_PORT=5199 pnpm exec playwright test
 *
 * runs against the stack and vite you already have up. Only pin ports whose
 * servers are built from THIS checkout: reuse cannot tell whose source answers,
 * and a sibling worktree's vite gets silently adopted. scripts/free-e2e-port.mjs
 * guards the vite port against foreign squatters when you pin it.
 */
const PORT_VARS = ['DEV_API_PORT', 'DEV_PROVIDER_PORT', 'DEV_PREFS_PORT', 'E2E_PORT'] as const
const unpinned = PORT_VARS.filter(v => !process.env[v])
if (unpinned.length > 0) {
  const ports = JSON.parse(
    execFileSync(process.execPath, ['scripts/free-ports.mjs', String(unpinned.length)], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf-8'
    })
  ) as number[]
  unpinned.forEach((v, i) => (process.env[v] = String(ports[i])))
}
const PORT = Number(process.env.E2E_PORT)
const API_PORT = Number(process.env.DEV_API_PORT)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]],
  timeout: 60000,
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Locally there are no retries, so 'on-first-retry' would never record: a
    // one-off failure under load left nothing to read once the run was rerun.
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure'
  },
  projects: [
    {
      name: 'hadoku-task-chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: [
    {
      // The real task worker, the preset stub and the real prefs-api, on the
      // ports chosen above. `[dev-api] ready` is printed only once both workers
      // answer over HTTP; dev-api.mjs exits when any child dies (a port taken
      // between the pick and the bind), which fails the run instead of letting
      // specs that need the stack skip themselves.
      command: 'node scripts/dev-api.mjs',
      url: `http://127.0.0.1:${API_PORT}/task/api/automation/presets`,
      wait: { stdout: /\[dev-api\] ready/ },
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe'
    },
    {
      // Skip the package build when dist artifacts already exist — saves ~30s on
      // iterative dev runs. CI starts cold so `node -e ...` evaluates false and
      // build:packages runs (incremental tsc keeps it fast on warm caches too).
      // --strictPort so a port we could not bind is an error, not a silent
      // rebind to the next one while every spec keeps requesting this one.
      command: `node scripts/free-e2e-port.mjs && { node -e "process.exit(require('fs').existsSync('./themes/dist/index.js') && require('fs').existsSync('./task-ui-components/dist/index.js') ? 0 : 1)" || pnpm run build:packages; pnpm exec vite --port ${PORT} --strictPort; }`,
      url: `http://localhost:${PORT}`,
      // Reuse only ever happens on a pinned port (see the header); CI always
      // starts fresh.
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
      stdout: 'pipe',
      stderr: 'pipe'
    }
  ]
})
