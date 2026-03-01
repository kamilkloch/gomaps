import type { APIRequestContext } from '@playwright/test'

interface SeedFixturesPayload {
  existingProjectId?: string
  project: {
    name: string
    bounds: string
  }
  scrapeRun?: {
    query?: string
    status?: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
    tilesTotal?: number
    tilesCompleted?: number
    tilesSubdivided?: number
    placesFound?: number
    placesUnique?: number
  }
  tiles?: Array<{
    bounds: string
    zoomLevel: number
    status?: 'pending' | 'running' | 'completed' | 'subdivided'
    resultCount?: number
  }>
  places?: Array<{
    id: string
    googleMapsUri: string
    name: string
    lat: number
    lng: number
    category?: string
    rating?: number
    reviewCount?: number
    priceLevel?: string
    phone?: string
    website?: string
    websiteType?: 'direct' | 'ota' | 'social' | 'unknown'
    address?: string
    photoUrls?: string[]
    openingHours?: string
    amenities?: string[]
  }>
}

interface SeedFixturesResponse {
  projectId: string
  scrapeRunId: string | null
  placeIds: string[]
}

const SERVER_BASE_URL = process.env.E2E_SERVER_BASE_URL ?? 'http://127.0.0.1:3000'

export async function resetDatabaseForE2E(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${SERVER_BASE_URL}/api/test/reset-db`)
  if (response.status() === 404) {
    throw new Error('E2E reset endpoint unavailable. Ensure server runs with E2E_TEST_MODE=1.')
  }

  if (!response.ok()) {
    throw new Error(`Failed to reset test database: HTTP ${response.status()}`)
  }
}

export async function seedFixtures(
  request: APIRequestContext,
  payload: SeedFixturesPayload,
): Promise<SeedFixturesResponse> {
  const response = await request.post(`${SERVER_BASE_URL}/api/test/seed-fixtures`, {
    data: payload,
  })

  if (!response.ok()) {
    throw new Error(`Failed to seed fixtures: HTTP ${response.status()} ${await response.text()}`)
  }

  return response.json() as Promise<SeedFixturesResponse>
}
