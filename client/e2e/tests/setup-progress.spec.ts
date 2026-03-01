import { expect, test } from '../fixtures/base'
import { captureStepScreenshot } from '../utils/screenshots'
import { seedFixtures } from '../utils/test-backdoor'
import { expectGoogleMapHasContent, expectGoogleMapRendered } from '../utils/waiters'
import type { Page } from '@playwright/test'

const mapsKeyForE2E = (process.env.VITE_GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? '').trim()
const shouldRequireInteractiveMaps = mapsKeyForE2E.length > 0
  && mapsKeyForE2E !== 'your_google_maps_api_key_here'
  && mapsKeyForE2E !== 'your_key_here'

type RunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed'

interface MockProgressState {
  scrapeRunId: string
  status: RunStatus
  tilesTotal: number
  tilesCompleted: number
  tilesSubdivided: number
  placesFound: number
  placesUnique: number
  elapsedMs: number
}

interface TileOverlayDebugEntry {
  id: string
  status: 'pending' | 'running' | 'completed' | 'subdivided'
  visible: boolean
  fillColor: string | null
  strokeColor: string | null
}

test.describe('setup progress + status e2e story-board coverage', () => {
  test('run status badges render every status with matching class', async ({ page, request }, testInfo) => {
    const statuses: RunStatus[] = ['pending', 'running', 'paused', 'completed', 'failed']
    let projectId: string | null = null
    const seededRuns: Array<{ id: string; status: RunStatus }> = []

    for (const status of statuses) {
      const seeded = await seedFixtures(request, {
        existingProjectId: projectId ?? undefined,
        project: {
          name: 'Setup Status Variants',
          bounds: JSON.stringify({ sw: { lat: 40.05, lng: 9.05 }, ne: { lat: 40.35, lng: 9.45 } }),
        },
        scrapeRun: {
          query: `${status} run`,
          status,
          tilesTotal: 8,
          tilesCompleted: status === 'completed' ? 8 : 2,
          tilesSubdivided: status === 'completed' ? 1 : 0,
          placesFound: status === 'pending' ? 0 : 12,
          placesUnique: status === 'pending' ? 0 : 10,
        },
      })

      projectId = seeded.projectId
      if (!seeded.scrapeRunId) {
        throw new Error(`Missing scrapeRunId for seeded status ${status}`)
      }
      seededRuns.push({ id: seeded.scrapeRunId, status })
    }

    if (!projectId) {
      throw new Error('Failed to seed setup status project')
    }

    await page.goto(`/projects/${projectId}/setup`)
    await expect(page.getByTestId('setup-page')).toBeVisible()
    await expect(page.getByTestId('setup-runs-section')).toBeVisible()

    for (const run of seededRuns) {
      const runButton = page.getByTestId(`setup-run-${run.id}`)
      await expect(runButton).toBeVisible()
      await expect(runButton).toContainText(run.status)
      await expect(runButton.locator(`.setup-run-status-${run.status}`)).toBeVisible()
    }

    await captureStepScreenshot(page, testInfo, 'setup-run-status-badges')
  })

  test('running progress bar shows animated 50% fill with elapsed and ETA stats', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Setup Progress Width',
        bounds: JSON.stringify({ sw: { lat: 40.1, lng: 9.1 }, ne: { lat: 40.4, lng: 9.5 } }),
      },
      scrapeRun: {
        query: 'halfway hotels',
        status: 'running',
        tilesTotal: 10,
        tilesCompleted: 5,
        tilesSubdivided: 0,
        placesFound: 20,
        placesUnique: 18,
      },
    })

    if (!seeded.scrapeRunId) {
      throw new Error('Missing scrapeRunId for setup progress width test')
    }

    const mockedProgress: MockProgressState = {
      scrapeRunId: seeded.scrapeRunId,
      status: 'running',
      tilesTotal: 10,
      tilesCompleted: 5,
      tilesSubdivided: 0,
      placesFound: 20,
      placesUnique: 18,
      elapsedMs: 120_000,
    }

    await page.route(`**/api/scrape/${seeded.scrapeRunId}`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockedProgress),
      })
    })

    await page.route(`**/api/scrape/${seeded.scrapeRunId}/progress`, async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: toSseBody(mockedProgress),
      })
    })

    await page.goto(`/projects/${seeded.projectId}/setup`)
    await expect(page.getByTestId('setup-page')).toBeVisible()
    await expect(page.getByTestId('setup-progress-section')).toBeVisible()

    const progressFill = page.locator('.setup-progress-fill')
    await expect(progressFill).toHaveClass(/is-running/)
    await expect(progressFill).toHaveAttribute('style', /50%/)
    await expect(page.getByTestId('setup-progress-section')).toContainText('Tiles: 5/10 (0 subdivided)')
    await expect(page.getByTestId('setup-progress-section')).toContainText('Time: 2m 00s · Est. remaining 2m 00s')
    await captureStepScreenshot(page, testInfo, 'setup-progress-halfway')
  })

  test('pause/resume control toggles Pausing… -> Resume and Resuming… -> Pause', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Setup Pause Resume',
        bounds: JSON.stringify({ sw: { lat: 40.12, lng: 9.12 }, ne: { lat: 40.42, lng: 9.52 } }),
      },
      scrapeRun: {
        query: 'toggle run',
        status: 'running',
        tilesTotal: 12,
        tilesCompleted: 6,
        tilesSubdivided: 1,
        placesFound: 25,
        placesUnique: 20,
      },
    })

    if (!seeded.scrapeRunId) {
      throw new Error('Missing scrapeRunId for pause/resume test')
    }

    const runState = {
      run: {
        id: seeded.scrapeRunId,
        projectId: seeded.projectId,
        query: 'toggle run',
        status: 'running' as RunStatus,
        tilesTotal: 12,
        tilesCompleted: 6,
        tilesSubdivided: 1,
        placesFound: 25,
        placesUnique: 20,
        startedAt: new Date(Date.now() - 180_000).toISOString(),
        completedAt: null as string | null,
      },
      progress: {
        scrapeRunId: seeded.scrapeRunId,
        status: 'running' as RunStatus,
        tilesTotal: 12,
        tilesCompleted: 6,
        tilesSubdivided: 1,
        placesFound: 25,
        placesUnique: 20,
        elapsedMs: 180_000,
      },
    }

    await page.route('**/api/scrape**', async (route) => {
      const url = new URL(route.request().url())
      const method = route.request().method()

      if (url.pathname === '/api/scrape' && url.searchParams.get('projectId') === seeded.projectId) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([runState.run]),
        })
        return
      }

      if (url.pathname === `/api/scrape/${seeded.scrapeRunId}` && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(runState.progress),
        })
        return
      }

      if (url.pathname === `/api/scrape/${seeded.scrapeRunId}/progress`) {
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
          body: toSseBody(runState.progress),
        })
        return
      }

      if (url.pathname === `/api/scrape/${seeded.scrapeRunId}/pause` && method === 'POST') {
        await delay(250)
        runState.run.status = 'paused'
        runState.progress.status = 'paused'
        await route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'pausing' }),
        })
        return
      }

      if (url.pathname === `/api/scrape/${seeded.scrapeRunId}/resume` && method === 'POST') {
        await delay(250)
        runState.run.status = 'running'
        runState.progress.status = 'running'
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'running' }),
        })
        return
      }

      await route.fallback()
    })

    await page.goto(`/projects/${seeded.projectId}/setup`)
    await expect(page.getByTestId('setup-page')).toBeVisible()

    const pauseResumeButton = page.getByTestId('setup-pause-resume-button')
    await expect(pauseResumeButton).toHaveText('Pause')

    await pauseResumeButton.click()
    await expect(pauseResumeButton).toHaveText('Pausing…')
    await expect(pauseResumeButton).toHaveText('Resume')

    await pauseResumeButton.click()
    await expect(pauseResumeButton).toHaveText('Resuming…')
    await expect(pauseResumeButton).toHaveText('Pause')
    await captureStepScreenshot(page, testInfo, 'setup-pause-resume-toggle')
  })

  test('SSE progress stream updates setup progress without navigation refresh', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Setup SSE Progress',
        bounds: JSON.stringify({ sw: { lat: 40.2, lng: 9.2 }, ne: { lat: 40.5, lng: 9.6 } }),
      },
      scrapeRun: {
        query: 'sse streaming run',
        status: 'running',
        tilesTotal: 10,
        tilesCompleted: 2,
        tilesSubdivided: 0,
        placesFound: 8,
        placesUnique: 7,
      },
    })

    if (!seeded.scrapeRunId) {
      throw new Error('Missing scrapeRunId for SSE progress test')
    }

    const progressState = {
      current: {
        scrapeRunId: seeded.scrapeRunId,
        status: 'running' as RunStatus,
        tilesTotal: 10,
        tilesCompleted: 2,
        tilesSubdivided: 0,
        placesFound: 8,
        placesUnique: 7,
        elapsedMs: 40_000,
      },
      streamed: {
        scrapeRunId: seeded.scrapeRunId,
        status: 'running' as RunStatus,
        tilesTotal: 10,
        tilesCompleted: 6,
        tilesSubdivided: 1,
        placesFound: 19,
        placesUnique: 15,
        elapsedMs: 110_000,
      },
    }

    await page.route('**/api/scrape**', async (route) => {
      const url = new URL(route.request().url())
      const method = route.request().method()

      if (url.pathname === `/api/scrape/${seeded.scrapeRunId}` && method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(progressState.current),
        })
        return
      }

      if (url.pathname === `/api/scrape/${seeded.scrapeRunId}/progress`) {
        await delay(300)
        progressState.current = progressState.streamed
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
          body: toSseBody(progressState.streamed),
        })
        return
      }

      await route.fallback()
    })

    const setupUrl = `/projects/${seeded.projectId}/setup`
    await page.goto(setupUrl)
    await expect(page.getByTestId('setup-page')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`${setupUrl}$`))

    await expect(page.getByTestId('setup-progress-section')).toContainText('Tiles: 2/10 (0 subdivided)')
    await expect(page.getByTestId('setup-progress-section')).toContainText('Places: 8 (7 unique)')
    await expect(page.getByTestId('setup-progress-section')).toContainText('Tiles: 6/10 (1 subdivided)')
    await expect(page.getByTestId('setup-progress-section')).toContainText('Places: 19 (15 unique)')
    await captureStepScreenshot(page, testInfo, 'setup-sse-updated-progress')
  })

  test('tile overlay status colors are exposed for interactive map rendering', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Setup Tile Colors',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.4, lng: 9.4 } }),
      },
      scrapeRun: {
        query: 'tile color coverage',
        status: 'running',
        tilesTotal: 4,
        tilesCompleted: 1,
        tilesSubdivided: 1,
        placesFound: 12,
        placesUnique: 10,
      },
      tiles: [
        {
          bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.1, lng: 9.1 } }),
          zoomLevel: 9,
          status: 'completed',
          resultCount: 3,
        },
        {
          bounds: JSON.stringify({ sw: { lat: 40.1, lng: 9.1 }, ne: { lat: 40.2, lng: 9.2 } }),
          zoomLevel: 9,
          status: 'running',
          resultCount: 2,
        },
        {
          bounds: JSON.stringify({ sw: { lat: 40.2, lng: 9.2 }, ne: { lat: 40.3, lng: 9.3 } }),
          zoomLevel: 9,
          status: 'pending',
          resultCount: 0,
        },
        {
          bounds: JSON.stringify({ sw: { lat: 40.3, lng: 9.3 }, ne: { lat: 40.4, lng: 9.4 } }),
          zoomLevel: 9,
          status: 'subdivided',
          resultCount: 60,
        },
      ],
    })

    await page.goto(`/projects/${seeded.projectId}/setup`)
    await expect(page.getByTestId('setup-page')).toBeVisible()

    const mapMode = await expectGoogleMapRendered(page, 'setup-map-shell', 'setup-map-fallback')
    if (shouldRequireInteractiveMaps) {
      expect(mapMode).toBe('interactive')
    }
    test.skip(mapMode === 'fallback', 'Tile overlay color assertions require interactive Google Maps rendering')

    await expectGoogleMapHasContent(page, 'setup-map-shell')
    await expect(page.getByTestId('setup-map-diagnostic')).toHaveCount(0)

    await expect.poll(async () => (await readTileOverlayDebugSnapshot(page)).length).toBeGreaterThanOrEqual(4)
    const overlaySnapshot = await readTileOverlayDebugSnapshot(page)

    expect(findEntry(overlaySnapshot, 'completed')).toMatchObject({
      status: 'completed',
      visible: true,
      fillColor: '#2a9d63',
      strokeColor: '#4ad18a',
    })
    expect(findEntry(overlaySnapshot, 'running')).toMatchObject({
      status: 'running',
      visible: true,
      fillColor: '#d6b443',
      strokeColor: '#f0ca53',
    })
    expect(findEntry(overlaySnapshot, 'pending')).toMatchObject({
      status: 'pending',
      visible: true,
      fillColor: '#304158',
      strokeColor: '#71839f',
    })
    expect(findEntry(overlaySnapshot, 'subdivided')).toMatchObject({
      status: 'subdivided',
      visible: false,
      fillColor: '#304158',
      strokeColor: '#71839f',
    })

    await captureStepScreenshot(page, testInfo, 'setup-tile-overlay-colors')
  })

  test('map diagnostic copy covers API key error, init timeout, and tile timeout scenarios', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Setup Map Diagnostics',
        bounds: JSON.stringify({ sw: { lat: 40.08, lng: 9.08 }, ne: { lat: 40.28, lng: 9.38 } }),
      },
    })

    const scenarios = [
      {
        key: 'api-key-error',
        expected: 'Unable to load Google Maps. Check that your API key is valid and allows Maps JavaScript API for localhost.',
      },
      {
        key: 'init-timeout',
        expected: 'Map did not initialize. Verify `VITE_GOOGLE_MAPS_API_KEY`, ensure Maps JavaScript API is enabled, and allow `http://localhost:5173/*` in key referrer restrictions.',
      },
      {
        key: 'tiles-timeout',
        expected: 'Google Maps initialized but tiles did not render. Check network/ad-blockers and key referrer restrictions for map tile requests.',
      },
    ] as const

    for (const scenario of scenarios) {
      await page.goto(`/projects/${seeded.projectId}/setup?e2eMapDiagnostic=${scenario.key}`)
      await expect(page.getByTestId('setup-page')).toBeVisible()
      await expect(page.getByTestId('setup-map-diagnostic')).toHaveText(scenario.expected)
      await captureStepScreenshot(page, testInfo, `setup-map-diagnostic-${scenario.key}`)
    }
  })
})

const toSseBody = (progress: MockProgressState): string =>
  `retry: 100\ndata: ${JSON.stringify(progress)}\n\n`

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const readTileOverlayDebugSnapshot = async (page: Page): Promise<TileOverlayDebugEntry[]> => {
  const raw = await page.getByTestId('setup-tile-overlay-debug').textContent()
  if (!raw || raw.trim().length === 0) {
    return []
  }

  return JSON.parse(raw) as TileOverlayDebugEntry[]
}

const findEntry = (
  entries: TileOverlayDebugEntry[],
  status: TileOverlayDebugEntry['status'],
): TileOverlayDebugEntry => {
  const entry = entries.find((item) => item.status === status)
  if (!entry) {
    throw new Error(`Missing tile overlay debug entry for status ${status}`)
  }
  return entry
}
