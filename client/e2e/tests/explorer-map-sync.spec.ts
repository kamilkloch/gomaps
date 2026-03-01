import { expect, test } from '../fixtures/base'
import { createExplorerPage } from '../pages/explorer-page'
import { captureStepScreenshot } from '../utils/screenshots'
import { seedFixtures } from '../utils/test-backdoor'
import { expectGoogleMapHasContent, expectGoogleMapRendered } from '../utils/waiters'
import type { Page } from '@playwright/test'

const mapsKeyForE2E = (process.env.VITE_GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? '').trim()
const shouldRequireInteractiveMaps = mapsKeyForE2E.length > 0
  && mapsKeyForE2E !== 'your_google_maps_api_key_here'
  && mapsKeyForE2E !== 'your_key_here'

interface MarkerDebugEntry {
  placeId: string
  rating: number | null
  fillColor: string
}

interface ClusterDebugSnapshot {
  totalClusters: number
  groupedClusterCount: number
  clusterLabels: string[]
  maxClusterSize: number
}

interface SelectionCircleDebugSnapshot {
  visible: boolean
  placeId: string | null
  center: { lat: number; lng: number } | null
  radius: number | null
}

interface ExplorerMapDebugController {
  clickMarker?: (placeId: string) => boolean
  clickMap?: () => boolean
  setZoom?: (zoom: number) => boolean
}

declare global {
  interface Window {
    __gomapsExplorerDebug?: ExplorerMapDebugController
  }
}

test.describe('explorer map interaction and table-sync story-boards', () => {
  test('map marker selection syncs table/detail and map click clears selection', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Explorer Map Sync Selection',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.5, lng: 9.5 } }),
      },
      places: [
        {
          id: 'map-sync-alpha',
          googleMapsUri: 'https://maps.google.com/?cid=map-sync-alpha',
          name: 'Map Sync Alpha',
          rating: 4.7,
          address: 'Alpha Street 1',
          lat: 40.11,
          lng: 9.11,
        },
        {
          id: 'map-sync-beta',
          googleMapsUri: 'https://maps.google.com/?cid=map-sync-beta',
          name: 'Map Sync Beta',
          rating: 4.2,
          address: 'Beta Street 2',
          lat: 40.12,
          lng: 9.12,
        },
        {
          id: 'map-sync-gamma',
          googleMapsUri: 'https://maps.google.com/?cid=map-sync-gamma',
          name: 'Map Sync Gamma',
          rating: 3.8,
          address: 'Gamma Street 3',
          lat: 40.13,
          lng: 9.13,
        },
      ],
    })

    const explorerPage = createExplorerPage(page)
    await explorerPage.goto(seeded.projectId)
    await captureStepScreenshot(page, testInfo, 'explorer-map-sync-before-selection')

    const mapMode = await expectGoogleMapRendered(page, 'explorer-map-panel', 'explorer-map-fallback')
    if (shouldRequireInteractiveMaps) {
      expect(mapMode).toBe('interactive')
    }
    test.skip(mapMode !== 'interactive', 'Interactive map unavailable; skipping map interaction assertions.')

    await expectGoogleMapHasContent(page, 'explorer-map-panel')
    await expect.poll(async () => (await readMarkerDebug(page)).length).toBe(3)

    expect(await runMapDebugAction(page, 'clickMarker', 'map-sync-beta')).toBe(true)
    await expect(page.getByTestId('explorer-row-map-sync-beta')).toHaveAttribute('data-selected', 'true')
    await expect(page.getByTestId('explorer-detail-name')).toHaveText('Map Sync Beta')

    await expect.poll(async () => (await readSelectionCircleDebug(page)).visible).toBe(true)
    await expect.poll(async () => (await readSelectionCircleDebug(page)).placeId).toBe('map-sync-beta')
    await expect.poll(async () => (await readSelectionCircleDebug(page)).radius ?? 0).toBeGreaterThan(0)
    await captureStepScreenshot(page, testInfo, 'explorer-map-sync-after-marker-selection')

    expect(await runMapDebugAction(page, 'clickMap')).toBe(true)
    await expect(page.locator('[data-testid^="explorer-row-"][data-selected="true"]')).toHaveCount(0)
    await expect(page.getByTestId('explorer-detail-panel')).toContainText('Select a marker to inspect place details.')
    await expect.poll(async () => (await readSelectionCircleDebug(page)).visible).toBe(false)
    await captureStepScreenshot(page, testInfo, 'explorer-map-sync-after-map-deselect')
  })

  test('cluster debug snapshot reports grouped marker clusters with numeric labels', async ({ page, request }, testInfo) => {
    const clusterPlaces = Array.from({ length: 240 }, (_, index) => {
      const row = Math.floor(index / 20)
      const col = index % 20
      return {
        id: `cluster-place-${index}`,
        googleMapsUri: `https://maps.google.com/?cid=cluster-place-${index}`,
        name: `Cluster Place ${index}`,
        rating: 3.6 + ((index % 10) * 0.1),
        lat: 40.2 + (row * 0.0012),
        lng: 9.2 + (col * 0.0012),
      }
    })

    const seeded = await seedFixtures(request, {
      project: {
        name: 'Explorer Cluster Snapshot',
        bounds: JSON.stringify({ sw: { lat: 40.15, lng: 9.15 }, ne: { lat: 40.35, lng: 9.35 } }),
      },
      places: clusterPlaces,
    })

    const explorerPage = createExplorerPage(page)
    await explorerPage.goto(seeded.projectId)
    await captureStepScreenshot(page, testInfo, 'explorer-cluster-before-zoom')

    const mapMode = await expectGoogleMapRendered(page, 'explorer-map-panel', 'explorer-map-fallback')
    if (shouldRequireInteractiveMaps) {
      expect(mapMode).toBe('interactive')
    }
    test.skip(mapMode !== 'interactive', 'Interactive map unavailable; skipping clustering assertions.')

    await expectGoogleMapHasContent(page, 'explorer-map-panel')
    await expect.poll(async () => (await readMarkerDebug(page)).length).toBe(240)

    expect(await runMapDebugAction(page, 'setZoom', 5)).toBe(true)

    await expect.poll(async () => (await readClusterDebug(page)).groupedClusterCount).toBeGreaterThan(0)
    await expect.poll(async () => (await readClusterDebug(page)).maxClusterSize).toBeGreaterThan(1)
    await expect.poll(async () => {
      const labels = (await readClusterDebug(page)).clusterLabels
      return labels.some((label) => Number.parseInt(label, 10) > 1)
    }).toBe(true)
    await captureStepScreenshot(page, testInfo, 'explorer-cluster-after-zoom')
  })

  test('table filter stays table-only while global search filters both map and table', async ({ page, request }, testInfo) => {
    const harborPlaces = Array.from({ length: 10 }, (_, index) => ({
      id: `harbor-place-${index}`,
      googleMapsUri: `https://maps.google.com/?cid=harbor-place-${index}`,
      name: `Harbor Inn ${index}`,
      category: 'Hotel',
      address: index < 5 ? `Blue Lane ${index}` : `Red Lane ${index}`,
      rating: 4.1 + ((index % 4) * 0.1),
      lat: 40.31 + (index * 0.001),
      lng: 9.31 + (index * 0.001),
      websiteType: 'direct' as const,
    }))

    const hillPlaces = Array.from({ length: 15 }, (_, index) => ({
      id: `hill-place-${index}`,
      googleMapsUri: `https://maps.google.com/?cid=hill-place-${index}`,
      name: `Hill Stay ${index}`,
      category: 'B&B',
      address: `Hill Road ${index}`,
      rating: 3.5 + ((index % 6) * 0.1),
      lat: 40.45 + (index * 0.001),
      lng: 9.45 + (index * 0.001),
      websiteType: 'ota' as const,
    }))

    const seeded = await seedFixtures(request, {
      project: {
        name: 'Explorer Search Filter Composition',
        bounds: JSON.stringify({ sw: { lat: 40.25, lng: 9.25 }, ne: { lat: 40.65, lng: 9.65 } }),
      },
      places: [...harborPlaces, ...hillPlaces],
    })

    const explorerPage = createExplorerPage(page)
    await explorerPage.goto(seeded.projectId)
    await captureStepScreenshot(page, testInfo, 'explorer-search-filter-before')

    const mapMode = await expectGoogleMapRendered(page, 'explorer-map-panel', 'explorer-map-fallback')
    if (shouldRequireInteractiveMaps) {
      expect(mapMode).toBe('interactive')
    }
    test.skip(mapMode !== 'interactive', 'Interactive map unavailable; skipping map/table filter assertions.')

    await expectGoogleMapHasContent(page, 'explorer-map-panel')
    await expect.poll(async () => (await readMarkerDebug(page)).length).toBe(25)

    await explorerPage.search('Harbor')
    await expect(page.getByTestId('explorer-table-count')).toContainText('10 places')
    await expect.poll(async () => (await readMarkerDebug(page)).length).toBe(10)

    await page.getByTestId('explorer-table-filter-input').fill('Blue Lane')
    await expect(page.getByTestId('explorer-table-count')).toContainText('5 places')
    await expect.poll(async () => (await readMarkerDebug(page)).length).toBe(10)

    await page.getByTestId('explorer-table-filter-input').fill('Harbor Inn 3')
    await expect(page.getByTestId('explorer-table-count')).toContainText('1 places')
    await expect(page.getByTestId('explorer-row-harbor-place-3')).toBeVisible()
    await expect.poll(async () => (await readMarkerDebug(page)).length).toBe(10)
    await captureStepScreenshot(page, testInfo, 'explorer-search-filter-after')
  })
})

async function readMarkerDebug(page: Page): Promise<MarkerDebugEntry[]> {
  return readDebugSnapshot(page, 'explorer-marker-debug', [])
}

async function readClusterDebug(page: Page): Promise<ClusterDebugSnapshot> {
  return readDebugSnapshot(page, 'explorer-cluster-debug', {
    totalClusters: 0,
    groupedClusterCount: 0,
    clusterLabels: [],
    maxClusterSize: 0,
  })
}

async function readSelectionCircleDebug(page: Page): Promise<SelectionCircleDebugSnapshot> {
  return readDebugSnapshot(page, 'explorer-selection-circle-debug', {
    visible: false,
    placeId: null,
    center: null,
    radius: null,
  })
}

async function readDebugSnapshot<T>(page: Page, testId: string, fallback: T): Promise<T> {
  const raw = await page.getByTestId(testId).textContent()
  if (!raw) {
    return fallback
  }

  try {
    return JSON.parse(raw) as T
  }
  catch {
    return fallback
  }
}

async function runMapDebugAction(page: Page, action: 'clickMarker' | 'clickMap' | 'setZoom', ...args: unknown[]): Promise<boolean> {
  return page.evaluate(
    ({ actionName, actionArgs }) => {
      const debugController = window.__gomapsExplorerDebug
      if (!debugController) {
        return false
      }

      const actionFn = debugController[actionName]
      if (typeof actionFn !== 'function') {
        return false
      }

      return Boolean(actionFn(...actionArgs))
    },
    { actionName: action, actionArgs: args },
  )
}
