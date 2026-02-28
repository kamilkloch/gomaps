import { defineConfig } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'

const rootEnvUrl = new URL('../.env', import.meta.url)

if (existsSync(rootEnvUrl)) {
  const envEntries = readFileSync(rootEnvUrl, 'utf8').split(/\r?\n/)
  for (const entry of envEntries) {
    const trimmed = entry.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, equalsIndex).trim().replace(/^export\s+/, '')
    if (!key || process.env[key]) {
      continue
    }

    const rawValue = trimmed.slice(equalsIndex + 1).trim()
    process.env[key] = rawValue.replace(/^['\"]|['\"]$/g, '')
  }
}

const e2eServerBaseUrl = process.env.E2E_SERVER_BASE_URL ?? 'http://127.0.0.1:3100'
process.env.E2E_SERVER_BASE_URL = e2eServerBaseUrl
const e2eMapsKey = process.env.VITE_GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? ''

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
      url: `${e2eServerBaseUrl}/health`,
      cwd: '..',
      env: {
        ...process.env,
        E2E_TEST_MODE: '1',
        PORT: '3100',
        DB_PATH: 'data/gomaps.e2e.db',
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev --workspace=client -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      cwd: '..',
      env: {
        ...process.env,
        VITE_API_PROXY_TARGET: e2eServerBaseUrl,
        VITE_GOOGLE_MAPS_API_KEY: e2eMapsKey,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
