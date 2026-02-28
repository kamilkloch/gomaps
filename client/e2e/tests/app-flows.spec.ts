import { createExplorerPage } from '../pages/explorer-page'
import { createProjectsPage } from '../pages/projects-page'
import { createSetupPage } from '../pages/setup-page'
import { expect, test } from '../fixtures/base'
import { resolveLocator } from '../utils/locators'
import { captureStepScreenshot } from '../utils/screenshots'
import { seedFixtures } from '../utils/test-backdoor'
import { expectGoogleMapRendered, panGoogleMap } from '../utils/waiters'

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
    await expectGoogleMapRendered(page, 'setup-map-shell', 'setup-map-fallback')
    await panGoogleMap(page, 'setup-map-shell')

    await setupPage.selectArea()
    await expect(page.getByTestId('setup-coordinates-pill')).toBeVisible()
    await expect(page.getByTestId('setup-status-copy')).toContainText('Selection saved to project')

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

    const projectsResponse = await request.get('http://127.0.0.1:3000/api/projects')
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

    await expectGoogleMapRendered(page, 'setup-map-shell', 'setup-map-fallback')
    await panGoogleMap(page, 'setup-map-shell')
    await expect(page.getByTestId('setup-runs-section')).toContainText('seeded hotels')
    await expect(page.getByTestId('setup-progress-section')).toBeVisible()
    await expect(page.getByTestId('setup-progress-section')).toContainText('Tiles: 3/3')
    await expect(page.getByTestId('setup-progress-section')).toContainText('Places: 4 (4 unique)')
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

    await expectGoogleMapRendered(page, 'explorer-map-panel', 'explorer-map-fallback')
    await panGoogleMap(page, 'explorer-map-panel')
    await expect(await explorerPage.root()).toBeVisible()
    await expect(page.getByTestId('explorer-table-count')).toContainText('2 places')

    await explorerPage.clickRow('seed-place-2')
    await expect(page.getByTestId('explorer-detail-name')).toContainText('Blue Harbor Rooms')
    await expect(page.getByTestId('explorer-row-seed-place-2')).toHaveAttribute('data-selected', 'true')

    await explorerPage.search('harbor')
    await expect(page.getByTestId('explorer-table-count')).toContainText('1 places')
    await expect(page.getByTestId('explorer-table')).toContainText('Blue Harbor Rooms')
    await expect(page.getByTestId('explorer-table')).not.toContainText('Garden Suites')

    await explorerPage.search('')
    await expect(page.getByTestId('explorer-table-count')).toContainText('2 places')
  })
})
