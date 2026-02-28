import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false,
  workers: 1,
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
      env: {
        ...process.env,
        E2E_TEST_MODE: '1',
        DB_PATH: 'data/gomaps.e2e.db',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run dev --workspace=client -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      cwd: '..',
      env: {
        ...process.env,
        VITE_GOOGLE_MAPS_API_KEY: process.env.VITE_GOOGLE_MAPS_API_KEY ?? '',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
