import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  outputDir: './e2e/test-results',
  webServer: [
    {
      command: 'npm run dev --workspace=server',
      url: 'http://127.0.0.1:3000/health',
      cwd: '..',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run dev --workspace=client -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      cwd: '..',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
