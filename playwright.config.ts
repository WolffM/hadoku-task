import { defineConfig, devices } from '@playwright/test'

const PORT = 5199 // Use a different port to avoid conflicts

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
    command: `pnpm run build:packages && pnpm exec vite --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false, // Always start fresh server
    timeout: 180000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
})
