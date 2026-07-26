import { defineConfig, devices } from '@playwright/test'

/**
 * Override with E2E_PORT when another worktree is already serving this one.
 * `reuseExistingServer` only checks that SOMETHING answers on the port — it
 * cannot tell whose source that is, so a sibling worktree's vite gets silently
 * reused and the browser tests code you did not write. Symptom: API-level specs
 * pass while UI specs fail on elements that plainly exist in your source.
 */
const PORT = Number(process.env.E2E_PORT ?? 5199)

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
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'hadoku-task-chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    // Skip the package build when dist artifacts already exist — saves ~30s on
    // iterative dev runs. CI starts cold so `node -e ...` evaluates false and
    // build:packages runs (incremental tsc keeps it fast on warm caches too).
    command: `node -e "process.exit(require('fs').existsSync('./themes/dist/index.js') && require('fs').existsSync('./task-ui-components/dist/index.js') ? 0 : 1)" || pnpm run build:packages; pnpm exec vite --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Reuse server on local dev (huge speedup); CI always starts fresh.
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
})
