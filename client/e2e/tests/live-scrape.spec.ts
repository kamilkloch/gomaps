import { expect, test } from '../fixtures/base'
import type { APIRequestContext } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureStepScreenshot } from '../utils/screenshots'

const E2E_SERVER_BASE_URL = process.env.E2E_SERVER_BASE_URL ?? 'http://127.0.0.1:3100'
const isLiveScrapeEnabled = process.env.E2E_LIVE_SCRAPE === '1'

interface ApiProject {
  id: string
  name: string
  bounds: string | null
  createdAt: string
}

interface ApiScrapeProgress {
  scrapeRunId: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  tilesTotal: number
  tilesCompleted: number
  tilesSubdivided: number
  placesFound: number
  placesUnique: number
  elapsedMs: number
}

interface ApiPlace {
  id: string
}

interface ApiScrapeRun {
  id: string
  query: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  tilesTotal: number
  tilesCompleted: number
  placesFound: number
  placesUnique: number
}

const KNOWN_RESULTS_BOUNDS = JSON.stringify({
  sw: { lat: 40.7355, lng: 14.9865 },
  ne: { lat: 40.7415, lng: 14.9925 },
})

test.describe('live scrape smoke (Google Places API)', () => {
  test.skip(!isLiveScrapeEnabled, 'Set E2E_LIVE_SCRAPE=1 to run live scrape tests.')

  test('runs a real small-area scrape from an empty database', async ({ request }) => {
    const projectsBefore = await request.get(`${E2E_SERVER_BASE_URL}/api/projects`)
    expect(projectsBefore.ok()).toBeTruthy()
    const projectsBeforeJson = await projectsBefore.json() as ApiProject[]
    expect(projectsBeforeJson).toEqual([])

    const placesBefore = await request.get(`${E2E_SERVER_BASE_URL}/api/places`)
    expect(placesBefore.ok()).toBeTruthy()
    const placesBeforeJson = await placesBefore.json() as unknown[]
    expect(placesBeforeJson).toEqual([])

    const createProjectResponse = await request.post(`${E2E_SERVER_BASE_URL}/api/projects`, {
      data: {
        name: `Live Scrape ${Date.now()}`,
        bounds: KNOWN_RESULTS_BOUNDS,
      },
    })
    expect(createProjectResponse.ok()).toBeTruthy()
    const createdProject = await createProjectResponse.json() as ApiProject

    const startResponse = await request.post(`${E2E_SERVER_BASE_URL}/api/scrape/start`, {
      data: {
        projectId: createdProject.id,
        query: 'hotel',
        delayMs: 0,
      },
    })
    expect(startResponse.status()).toBe(202)
    const { scrapeRunId } = await startResponse.json() as { scrapeRunId: string }

    const finalProgress = await waitForRunTerminalStatus(request, scrapeRunId, 180_000)
    expect(finalProgress.status).toBe('completed')
    expect(finalProgress.tilesTotal).toBeGreaterThan(0)
    expect(finalProgress.tilesCompleted).toBe(finalProgress.tilesTotal)

    if (finalProgress.placesFound > 0) {
      expect(finalProgress.placesUnique).toBeGreaterThan(0)

      const projectPlacesResponse = await request.get(
        `${E2E_SERVER_BASE_URL}/api/places?projectId=${createdProject.id}`
      )
      expect(projectPlacesResponse.ok()).toBeTruthy()
      const projectPlaces = await projectPlacesResponse.json() as ApiPlace[]
      expect(projectPlaces.length).toBeGreaterThan(0)
      expect(projectPlaces.length).toBe(finalProgress.placesUnique)
    }

    const tilesResponse = await request.get(`${E2E_SERVER_BASE_URL}/api/scrape/${scrapeRunId}/tiles`)
    expect(tilesResponse.ok()).toBeTruthy()
    const tiles = await tilesResponse.json() as Array<{ status: string }>
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles.some((tile) => tile.status === 'completed')).toBeTruthy()
  })

  test('setup UI launches live scrape and explorer reflects persisted results', async ({ page, request }, testInfo) => {
    const createProjectResponse = await request.post(`${E2E_SERVER_BASE_URL}/api/projects`, {
      data: {
        name: `Live UI Scrape ${Date.now()}`,
        bounds: KNOWN_RESULTS_BOUNDS,
      },
    })
    expect(createProjectResponse.status()).toBe(201)
    const createdProject = await createProjectResponse.json() as ApiProject

    await page.goto(`/projects/${createdProject.id}/setup`)
    await expect(page.getByTestId('setup-page')).toBeVisible()
    await expect(page.getByTestId('setup-status-copy')).toContainText('Selection saved to project.')
    await captureStepScreenshot(page, testInfo, 'live-ui-scrape-before-start')

    await page.getByTestId('setup-query-input').fill('hotel')
    const startResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/scrape/start')
      && response.request().method() === 'POST'
    )
    await page.getByTestId('setup-start-scrape-button').click()

    const startResponse = await startResponsePromise
    expect(startResponse.status()).toBe(202)
    const started = await startResponse.json() as { scrapeRunId: string }

    await expect(page.getByTestId('setup-runs-section')).toContainText('hotel')
    const finalProgress = await waitForRunTerminalStatus(request, started.scrapeRunId, 180_000)
    expect(finalProgress.status).toBe('completed')
    expect(finalProgress.placesUnique).toBeGreaterThan(0)

    const runResponse = await request.get(`${E2E_SERVER_BASE_URL}/api/scrape?projectId=${createdProject.id}`)
    expect(runResponse.ok()).toBeTruthy()
    const runs = await runResponse.json() as ApiScrapeRun[]
    const createdRun = runs.find((run) => run.id === started.scrapeRunId)
    expect(createdRun).toBeTruthy()
    expect(createdRun?.status).toBe('completed')
    expect(createdRun?.placesUnique).toBe(finalProgress.placesUnique)

    await expect(page.getByTestId('setup-progress-section')).toContainText(
      `Places: ${finalProgress.placesFound} (${finalProgress.placesUnique} unique)`
    )
    await captureStepScreenshot(page, testInfo, 'live-ui-scrape-after-complete')

    await page.goto(`/projects/${createdProject.id}/explorer`)
    await expect(page.getByTestId('explorer-page')).toBeVisible()
    await expect(page.getByTestId('explorer-table-count')).toContainText(`${finalProgress.placesUnique} places`)
  })

  test('migrates legacy places schema and persists scraped places', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'gomaps-legacy-e2e-'))
    const dbPath = join(tempDir, 'gomaps-legacy.db')

    try {
      execFileSync('sqlite3', [dbPath, LEGACY_SCHEMA_SQL])

      const port = 3300 + Math.floor(Math.random() * 200)
      const serverBaseUrl = `http://127.0.0.1:${port}`
      const server = spawn('npm', ['run', 'dev', '--workspace=server'], {
        cwd: '..',
        env: {
          ...process.env,
          PORT: String(port),
          DB_PATH: dbPath,
          E2E_TEST_MODE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let serverLogs = ''
      server.stdout.on('data', (chunk: Buffer) => {
        serverLogs += chunk.toString()
      })
      server.stderr.on('data', (chunk: Buffer) => {
        serverLogs += chunk.toString()
      })

      try {
        await waitForHealthyServer(serverBaseUrl, 120_000)

        const createdProject = await requestJson<ApiProject>(`${serverBaseUrl}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Legacy Migration ${Date.now()}`,
            bounds: KNOWN_RESULTS_BOUNDS,
          }),
        }, 201)

        const started = await requestJson<{ scrapeRunId: string }>(`${serverBaseUrl}/api/scrape/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: createdProject.id,
            query: 'hotel',
            delayMs: 0,
          }),
        }, 202)

        const finalProgress = await waitForRunTerminalStatusFromFetch(
          serverBaseUrl,
          started.scrapeRunId,
          180_000
        )
        expect(finalProgress.status).toBe('completed')

        if (finalProgress.placesFound > 0) {
          expect(finalProgress.placesUnique).toBeGreaterThan(0)
          const projectPlaces = await requestJson<ApiPlace[]>(
            `${serverBaseUrl}/api/places?projectId=${createdProject.id}`
          )
          expect(projectPlaces.length).toBe(finalProgress.placesUnique)
        }
      }
      catch (error) {
        throw new Error(
          `Legacy migration live scrape failed. Captured server logs:\n${serverLogs}\n${String(error)}`
        )
      }
      finally {
        server.kill('SIGTERM')
      }
    }
    finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

const waitForRunTerminalStatus = async (
  request: APIRequestContext,
  scrapeRunId: string,
  timeoutMs: number,
): Promise<ApiScrapeProgress> => {
  const deadline = Date.now() + timeoutMs
  let lastProgress: ApiScrapeProgress | null = null

  while (Date.now() < deadline) {
    const response = await request.get(`${E2E_SERVER_BASE_URL}/api/scrape/${scrapeRunId}`)
    if (!response.ok()) {
      throw new Error(`Failed to query scrape status: HTTP ${response.status()} ${await response.text()}`)
    }

    const progress = await response.json() as ApiScrapeProgress
    lastProgress = progress

    if (progress.status === 'completed' || progress.status === 'failed') {
      return progress
    }

    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  throw new Error(
    `Timed out waiting for scrape run ${scrapeRunId} to finish. Last status: ${lastProgress?.status ?? 'unknown'}`,
  )
}

const waitForHealthyServer = async (serverBaseUrl: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${serverBaseUrl}/health`)
      if (response.ok) {
        return
      }
    }
    catch {
      // server is still booting
    }

    await delay(500)
  }

  throw new Error(`Timed out waiting for health endpoint at ${serverBaseUrl}`)
}

const waitForRunTerminalStatusFromFetch = async (
  serverBaseUrl: string,
  scrapeRunId: string,
  timeoutMs: number,
): Promise<ApiScrapeProgress> => {
  const deadline = Date.now() + timeoutMs
  let lastProgress: ApiScrapeProgress | null = null

  while (Date.now() < deadline) {
    lastProgress = await requestJson<ApiScrapeProgress>(`${serverBaseUrl}/api/scrape/${scrapeRunId}`)

    if (lastProgress.status === 'completed' || lastProgress.status === 'failed') {
      return lastProgress
    }

    await delay(1500)
  }

  throw new Error(
    `Timed out waiting for scrape run ${scrapeRunId} to finish. Last status: ${lastProgress?.status ?? 'unknown'}`,
  )
}

const requestJson = async <T>(url: string, init?: RequestInit, expectedStatus = 200): Promise<T> => {
  const response = await fetch(url, init)
  if (response.status !== expectedStatus) {
    throw new Error(`Unexpected status ${response.status} for ${url}: ${await response.text()}`)
  }

  return await response.json() as T
}

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const LEGACY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bounds TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tiles_total INTEGER NOT NULL DEFAULT 0,
  tiles_completed INTEGER NOT NULL DEFAULT 0,
  tiles_subdivided INTEGER NOT NULL DEFAULT 0,
  places_found INTEGER NOT NULL DEFAULT 0,
  places_unique INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS tiles (
  id TEXT PRIMARY KEY,
  scrape_run_id TEXT NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  bounds TEXT NOT NULL,
  zoom_level INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  result_count INTEGER NOT NULL DEFAULT 0,
  parent_tile_id TEXT REFERENCES tiles(id)
);

CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  google_url TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  rating REAL,
  review_count INTEGER,
  price_level TEXT,
  phone TEXT,
  website TEXT,
  website_type TEXT NOT NULL DEFAULT 'unknown',
  address TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  photo_urls TEXT NOT NULL DEFAULT '[]',
  opening_hours TEXT,
  amenities TEXT NOT NULL DEFAULT '[]',
  scraped_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  text TEXT NOT NULL,
  relative_date TEXT
);

CREATE TABLE IF NOT EXISTS place_scrape_runs (
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  scrape_run_id TEXT NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  PRIMARY KEY (place_id, scrape_run_id)
);

CREATE TABLE IF NOT EXISTS shortlists (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shortlist_entries (
  shortlist_id TEXT NOT NULL REFERENCES shortlists(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (shortlist_id, place_id)
);
`
