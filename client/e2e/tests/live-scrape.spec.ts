import { expect, test } from '../fixtures/base'
import type { APIRequestContext } from '@playwright/test'

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

    const projectBounds = JSON.stringify({
      sw: { lat: 40.7355, lng: 14.9865 },
      ne: { lat: 40.7415, lng: 14.9925 },
    })

    const createProjectResponse = await request.post(`${E2E_SERVER_BASE_URL}/api/projects`, {
      data: {
        name: `Live Scrape ${Date.now()}`,
        bounds: projectBounds,
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
