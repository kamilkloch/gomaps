import { createExplorerPage } from '../pages/explorer-page'
import { createProjectsPage } from '../pages/projects-page'
import { createSetupPage } from '../pages/setup-page'
import { expect, test } from '../fixtures/base'
import { resolveLocator } from '../utils/locators'
import { captureStepScreenshot } from '../utils/screenshots'
import { seedFixtures } from '../utils/test-backdoor'
import { expectGoogleMapHasContent, expectGoogleMapRendered, panGoogleMap } from '../utils/waiters'

const E2E_SERVER_BASE_URL = process.env.E2E_SERVER_BASE_URL ?? 'http://127.0.0.1:3100'
const mapsKeyForE2E = (process.env.VITE_GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? '').trim()
const shouldRequireInteractiveMaps = mapsKeyForE2E.length > 0
  && mapsKeyForE2E !== 'your_google_maps_api_key_here'
  && mapsKeyForE2E !== 'your_key_here'

test.describe('core app flows (integrated backend + UI)', () => {
  test('project CRUD, setup navigation, and bounds persistence', async ({ page, request }, testInfo) => {
    const projectsPage = createProjectsPage(page)
    const setupPage = createSetupPage(page)
    const projectName = `Integration Project ${Date.now()}`

    await captureStepScreenshot(page, testInfo, 'projects-before-navigation')
    await projectsPage.goto()
    await captureStepScreenshot(page, testInfo, 'projects-after-navigation')

    await projectsPage.createProject(projectName)
    await projectsPage.openProjectByName(projectName)
    await expect(page).toHaveURL(/\/projects\/[^/]+\/setup$/)

    const setupUrlMatch = page.url().match(/\/projects\/([^/]+)\/setup$/)
    if (!setupUrlMatch) {
      throw new Error('Could not extract projectId from setup URL')
    }
    const projectId = setupUrlMatch[1]

    await expect(await setupPage.root()).toBeVisible()
    const setupMapMode = await expectGoogleMapRendered(page, 'setup-map-shell', 'setup-map-fallback')
    if (shouldRequireInteractiveMaps) {
      expect(setupMapMode).toBe('interactive')
      await expect(page.getByTestId('setup-map-diagnostic')).toHaveCount(0)
    }
    if (setupMapMode === 'interactive') {
      await expectGoogleMapHasContent(page, 'setup-map-shell')
      await panGoogleMap(page, 'setup-map-shell')
      await setupPage.selectArea()
      await expect(page.getByTestId('setup-coordinates-pill')).toBeVisible()
      await expect(page.getByTestId('setup-status-copy')).toContainText('Selection saved to project')
    }
    else {
      await expect(page.getByTestId('setup-status-copy')).toContainText('No area selected yet.')
    }

    const navProjects = await resolveLocator(page, {
      testId: 'nav-projects',
      role: 'link',
      name: /projects/i,
      text: 'Projects',
      defectLabel: 'Projects navigation link',
    })
    await navProjects.click()
    await expect(page).toHaveURL(/\/projects$/)

    await projectsPage.deleteProject(projectId)
    await expect(page.getByTestId(`project-card-${projectId}`)).toHaveCount(0)

    const projectsResponse = await request.get(`${E2E_SERVER_BASE_URL}/api/projects`)
    expect(projectsResponse.ok()).toBeTruthy()
    expect(await projectsResponse.json()).toEqual([])
  })

  test('setup page shows seeded run progress and tile metrics', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Seeded Setup Project',
        bounds: JSON.stringify({
          sw: { lat: 40.1, lng: 9.1 },
          ne: { lat: 40.4, lng: 9.6 },
        }),
      },
      scrapeRun: {
        query: 'seeded hotels',
        status: 'completed',
        tilesTotal: 3,
        tilesCompleted: 3,
        tilesSubdivided: 1,
        placesFound: 4,
        placesUnique: 4,
      },
      tiles: [
        {
          bounds: JSON.stringify({ sw: { lat: 40.1, lng: 9.1 }, ne: { lat: 40.2, lng: 9.25 } }),
          zoomLevel: 8,
          status: 'completed',
          resultCount: 2,
        },
        {
          bounds: JSON.stringify({ sw: { lat: 40.2, lng: 9.25 }, ne: { lat: 40.3, lng: 9.45 } }),
          zoomLevel: 8,
          status: 'completed',
          resultCount: 1,
        },
        {
          bounds: JSON.stringify({ sw: { lat: 40.3, lng: 9.45 }, ne: { lat: 40.4, lng: 9.6 } }),
          zoomLevel: 8,
          status: 'subdivided',
          resultCount: 3,
        },
      ],
    })

    const setupPage = createSetupPage(page)
    await setupPage.goto(seeded.projectId)
    await captureStepScreenshot(page, testInfo, 'setup-seeded-progress')

    const setupMapMode = await expectGoogleMapRendered(page, 'setup-map-shell', 'setup-map-fallback')
    if (shouldRequireInteractiveMaps) {
      expect(setupMapMode).toBe('interactive')
      await expect(page.getByTestId('setup-map-diagnostic')).toHaveCount(0)
    }
    if (setupMapMode === 'interactive') {
      await expectGoogleMapHasContent(page, 'setup-map-shell')
      await panGoogleMap(page, 'setup-map-shell')
    }
    await expect(page.getByTestId('setup-runs-section')).toContainText('seeded hotels')
    await expect(page.getByTestId('setup-progress-section')).toBeVisible()
    await expect(page.getByTestId('setup-progress-section')).toContainText('Tiles: 3/3')
    await expect(page.getByTestId('setup-progress-section')).toContainText('Places: 4 (4 unique)')
  })

  test('projects and setup stay consistent for mixed run history and explicit run switching', async ({ page, request }, testInfo) => {
    const completedSeed = await seedFixtures(request, {
      project: {
        name: 'Sardinia 2025',
        bounds: JSON.stringify({
          sw: { lat: 39.8, lng: 8.5 },
          ne: { lat: 40.9, lng: 9.8 },
        }),
      },
      scrapeRun: {
        query: 'sardinia completed run',
        status: 'completed',
        tilesTotal: 31,
        tilesCompleted: 31,
        tilesSubdivided: 7,
        placesFound: 312,
        placesUnique: 240,
      },
      places: [
        {
          id: 'sardinia-place-1',
          googleMapsUri: 'https://maps.google.com/?cid=sardinia-1',
          name: 'Sardinia Place 1',
          lat: 40.2,
          lng: 9.1,
        },
      ],
    })

    const runningSeed = await seedFixtures(request, {
      existingProjectId: completedSeed.projectId,
      project: {
        name: 'Sardinia 2025',
        bounds: JSON.stringify({
          sw: { lat: 39.8, lng: 8.5 },
          ne: { lat: 40.9, lng: 9.8 },
        }),
      },
      scrapeRun: {
        query: 'sardinia active run',
        status: 'running',
        tilesTotal: 13,
        tilesCompleted: 10,
        tilesSubdivided: 2,
        placesFound: 77,
        placesUnique: 64,
      },
      places: [
        {
          id: 'sardinia-place-2',
          googleMapsUri: 'https://maps.google.com/?cid=sardinia-2',
          name: 'Sardinia Place 2',
          lat: 40.3,
          lng: 9.2,
        },
      ],
    })

    await page.goto('/projects')
    await expect(page.getByTestId(`project-status-${completedSeed.projectId}`)).toHaveText('Running')
    await expect(page.getByTestId(`project-places-${completedSeed.projectId}`)).toContainText('Places: 2')
    await expect(page.getByTestId(`project-runs-${completedSeed.projectId}`)).toContainText('Scrape runs: 2')
    await captureStepScreenshot(page, testInfo, 'projects-sardinia-summary-consistent')

    await page.getByTestId(`project-card-${completedSeed.projectId}`).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${completedSeed.projectId}/setup$`))

    await expect(page.getByTestId('setup-runs-section')).toContainText('sardinia completed run')
    await expect(page.getByTestId('setup-runs-section')).toContainText('sardinia active run')
    await expect(page.getByTestId('setup-progress-section')).toContainText('Tiles: 10/13 (2 subdivided)')
    await expect(page.getByTestId('setup-progress-section')).toContainText('Places: 77 (64 unique)')

    await page.getByTestId(`setup-run-${completedSeed.scrapeRunId}`).click()
    await expect(page.getByTestId('setup-progress-section')).toContainText('Tiles: 31/31 (7 subdivided)')
    await expect(page.getByTestId('setup-progress-section')).toContainText('Places: 312 (240 unique)')

    await page.getByTestId(`setup-run-${runningSeed.scrapeRunId}`).click()
    await expect(page.getByTestId('setup-progress-section')).toContainText('Tiles: 10/13 (2 subdivided)')
    await expect(page.getByTestId('setup-progress-section')).toContainText('Places: 77 (64 unique)')
    await captureStepScreenshot(page, testInfo, 'setup-run-switch-consistent')
  })

  test('explorer map, table filtering, and detail-panel selection', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Seeded Explorer Project',
        bounds: JSON.stringify({
          sw: { lat: 39.9, lng: 8.9 },
          ne: { lat: 40.6, lng: 9.7 },
        }),
      },
      scrapeRun: {
        query: 'seeded explorer run',
        status: 'completed',
        tilesTotal: 2,
        tilesCompleted: 2,
        placesFound: 2,
        placesUnique: 2,
      },
      places: [
        {
          id: 'seed-place-1',
          googleMapsUri: 'https://maps.google.com/?cid=1',
          name: 'Garden Suites',
          category: 'Hotel',
          rating: 4.6,
          reviewCount: 220,
          priceLevel: '$$$',
          website: 'https://garden.example',
          websiteType: 'direct',
          address: 'Via Roma 10',
          lat: 40.2,
          lng: 9.2,
          photoUrls: ['https://example.com/1.jpg'],
          amenities: ['Pool', 'WiFi'],
        },
        {
          id: 'seed-place-2',
          googleMapsUri: 'https://maps.google.com/?cid=2',
          name: 'Blue Harbor Rooms',
          category: 'B&B',
          rating: 4.1,
          reviewCount: 120,
          priceLevel: '$$',
          website: 'https://booking.com/example',
          websiteType: 'ota',
          address: 'Harbor Street',
          lat: 40.3,
          lng: 9.3,
        },
      ],
    })

    const explorerPage = createExplorerPage(page)
    await explorerPage.goto(seeded.projectId)
    await captureStepScreenshot(page, testInfo, 'explorer-initial')

    const explorerMapMode = await expectGoogleMapRendered(page, 'explorer-map-panel', 'explorer-map-fallback')
    if (shouldRequireInteractiveMaps) {
      expect(explorerMapMode).toBe('interactive')
    }
    if (explorerMapMode === 'interactive') {
      await expectGoogleMapHasContent(page, 'explorer-map-panel')
      await panGoogleMap(page, 'explorer-map-panel')
    }
    await expect(await explorerPage.root()).toBeVisible()
    await expect(page.getByTestId('explorer-table-count')).toContainText('2 places')

    await page.getByRole('button', { name: /^rating/i }).click()
    await expect(page.getByTestId('explorer-table').locator('tbody tr').first()).toContainText('Blue Harbor Rooms')
    await page.getByRole('button', { name: /^rating/i }).click()
    await expect(page.getByTestId('explorer-table').locator('tbody tr').first()).toContainText('Garden Suites')

    await explorerPage.clickRow('seed-place-2')
    await expect(page.getByTestId('explorer-detail-name')).toContainText('Blue Harbor Rooms')
    await expect(page.getByTestId('explorer-row-seed-place-2')).toHaveAttribute('data-selected', 'true')

    await explorerPage.search('harbor')
    await expect(page.getByTestId('explorer-table-count')).toContainText('1 places')
    await expect(page.getByTestId('explorer-table')).toContainText('Blue Harbor Rooms')
    await expect(page.getByTestId('explorer-table')).not.toContainText('Garden Suites')

    await page.getByTestId('explorer-table-filter-input').fill('rooms')
    await expect(page.getByTestId('explorer-table-count')).toContainText('1 places')
    await page.getByTestId('explorer-table-filter-clear').click()
    await expect(page.getByTestId('explorer-table-count')).toContainText('1 places')

    await explorerPage.search('')
    await expect(page.getByTestId('explorer-table-count')).toContainText('2 places')
  })
})
