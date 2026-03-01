import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/base'
import { captureStepScreenshot } from '../utils/screenshots'
import { seedFixtures } from '../utils/test-backdoor'

test.describe('error handling, data isolation, and resilience story-boards', () => {
  test('projects page surfaces API failures during initial load without crashing', async ({ page }, testInfo) => {
    await page.route('**/api/projects*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()
        return
      }

      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'projects failed' }),
      })
    })

    await page.goto('/projects')
    await expect(page.getByTestId('projects-page')).toBeVisible()
    await expect(page.getByTestId('projects-error')).toContainText('Request failed (500)')
    await captureStepScreenshot(page, testInfo, 'resilience-projects-load-500')
  })

  test('explorer page shows error banner when places API fails', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Explorer Failure Story',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.4, lng: 9.4 } }),
      },
      places: [
        {
          id: 'explorer-failure-place-1',
          googleMapsUri: 'https://maps.google.com/?cid=explorer-failure-place-1',
          name: 'Explorer Failure Place',
          lat: 40.2,
          lng: 9.2,
        },
      ],
    })

    await page.route('**/api/places*', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()
        return
      }

      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'places failed' }),
      })
    })

    await page.goto(`/projects/${seeded.projectId}/explorer`)
    await expect(page.getByTestId('explorer-page')).toBeVisible()
    await expect(page.getByTestId('explorer-error')).toContainText('Unable to load explorer data right now.')
    await expect(page.getByTestId('explorer-table-count')).toContainText('0 places')
    await captureStepScreenshot(page, testInfo, 'resilience-explorer-load-500')
  })

  test('setup start scrape failure shows error and re-enables start button', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Setup Start Failure Story',
        bounds: JSON.stringify({ sw: { lat: 40.1, lng: 9.1 }, ne: { lat: 40.3, lng: 9.3 } }),
      },
    })

    await page.route('**/api/scrape/start', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback()
        return
      }

      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'start failed' }),
      })
    })

    await page.goto(`/projects/${seeded.projectId}/setup`)
    const startButton = page.getByTestId('setup-start-scrape-button')
    await expect(startButton).toBeEnabled()

    await startButton.click()
    await expect(page.getByTestId('setup-error')).toContainText('Unable to start scrape. Please try again.')
    await expect(startButton).toBeEnabled()
    await expect(startButton).toHaveText('Start Scrape')
    await captureStepScreenshot(page, testInfo, 'resilience-setup-start-500')
  })

  test('setup shows saving copy while bounds update request is pending', async ({ page, request }, testInfo) => {
    const projectName = 'Setup Save Timeout Story'
    const seeded = await seedFixtures(request, {
      project: {
        name: projectName,
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.25, lng: 9.25 } }),
      },
    })

    const pendingSave = createDeferred()
    await page.route(`**/api/projects/${seeded.projectId}`, async (route) => {
      if (route.request().method() !== 'PUT') {
        await route.fallback()
        return
      }

      const payload = route.request().postDataJSON() as { bounds?: string }
      await pendingSave.promise
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: seeded.projectId,
          name: projectName,
          bounds: payload.bounds && payload.bounds.length > 0 ? payload.bounds : null,
          createdAt: new Date().toISOString(),
        }),
      })
    })

    await page.goto(`/projects/${seeded.projectId}/setup`)
    await expect(page.getByTestId('setup-status-copy')).toContainText('Selection saved to project.')

    await page.getByTestId('setup-clear-area-button').click()
    await expect(page.getByTestId('setup-status-copy')).toHaveText('Saving bounds…')
    await captureStepScreenshot(page, testInfo, 'resilience-setup-saving-bounds')

    pendingSave.resolve()
    await expect(page.getByTestId('setup-status-copy')).toContainText('No area selected yet.')
  })

  test('explorer isolates places by selected project', async ({ page, request }, testInfo) => {
    const firstProject = await seedFixtures(request, {
      project: {
        name: 'Isolation Primary Project',
        bounds: JSON.stringify({ sw: { lat: 39.9, lng: 8.9 }, ne: { lat: 40.4, lng: 9.4 } }),
      },
      places: [
        {
          id: 'isolation-primary-place-1',
          googleMapsUri: 'https://maps.google.com/?cid=isolation-primary-place-1',
          name: 'Primary One',
          lat: 40.1,
          lng: 9.1,
        },
        {
          id: 'isolation-primary-place-2',
          googleMapsUri: 'https://maps.google.com/?cid=isolation-primary-place-2',
          name: 'Primary Two',
          lat: 40.2,
          lng: 9.2,
        },
      ],
    })

    const secondProject = await seedFixtures(request, {
      project: {
        name: 'Isolation Secondary Project',
        bounds: JSON.stringify({ sw: { lat: 40.8, lng: 9.8 }, ne: { lat: 41.2, lng: 10.2 } }),
      },
      places: [
        {
          id: 'isolation-secondary-place-1',
          googleMapsUri: 'https://maps.google.com/?cid=isolation-secondary-place-1',
          name: 'Secondary One',
          lat: 41.0,
          lng: 10.0,
        },
      ],
    })

    await page.goto(`/projects/${firstProject.projectId}/explorer`)
    await expect(page.getByTestId('explorer-table-count')).toContainText('2 places')
    await expect(page.getByTestId('explorer-row-isolation-primary-place-1')).toBeVisible()
    await expect(page.getByTestId('explorer-row-isolation-secondary-place-1')).toHaveCount(0)

    await page.getByTestId('explorer-project-select').selectOption(secondProject.projectId)
    await expect(page).toHaveURL(new RegExp(`/projects/${secondProject.projectId}/explorer$`))
    await expect(page.getByTestId('explorer-table-count')).toContainText('1 places')
    await expect(page.getByTestId('explorer-row-isolation-secondary-place-1')).toBeVisible()
    await expect(page.getByTestId('explorer-row-isolation-primary-place-1')).toHaveCount(0)
    await captureStepScreenshot(page, testInfo, 'resilience-explorer-project-isolation')
  })

  test('setup run picker handles concurrent running runs for one project', async ({ page, request }, testInfo) => {
    const firstRunSeed = await seedFixtures(request, {
      project: {
        name: 'Concurrent Runs Project',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.4, lng: 9.4 } }),
      },
      scrapeRun: {
        query: 'concurrent run alpha',
        status: 'running',
        tilesTotal: 10,
        tilesCompleted: 2,
        tilesSubdivided: 1,
        placesFound: 20,
        placesUnique: 16,
      },
    })

    const secondRunSeed = await seedFixtures(request, {
      existingProjectId: firstRunSeed.projectId,
      project: {
        name: 'Concurrent Runs Project',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.4, lng: 9.4 } }),
      },
      scrapeRun: {
        query: 'concurrent run beta',
        status: 'running',
        tilesTotal: 14,
        tilesCompleted: 7,
        tilesSubdivided: 2,
        placesFound: 55,
        placesUnique: 42,
      },
    })

    const firstRunId = requireScrapeRunId(firstRunSeed.scrapeRunId, 'first concurrent run')
    const secondRunId = requireScrapeRunId(secondRunSeed.scrapeRunId, 'second concurrent run')

    await page.goto(`/projects/${firstRunSeed.projectId}/setup`)
    await expect(page.getByTestId('setup-run-' + firstRunId)).toContainText('concurrent run alpha')
    await expect(page.getByTestId('setup-run-' + secondRunId)).toContainText('concurrent run beta')

    await page.getByTestId('setup-run-' + firstRunId).click()
    await expect(page.getByTestId('setup-progress-section')).toContainText('Tiles: 2/10 (1 subdivided)')
    await expect(page.getByTestId('setup-progress-section')).toContainText('Places: 20 (16 unique)')

    await page.getByTestId('setup-run-' + secondRunId).click()
    await expect(page.getByTestId('setup-progress-section')).toContainText('Tiles: 7/14 (2 subdivided)')
    await expect(page.getByTestId('setup-progress-section')).toContainText('Places: 55 (42 unique)')
    await captureStepScreenshot(page, testInfo, 'resilience-setup-concurrent-runs')
  })

  test('deleting a project cascades run data from project-scoped API responses', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Cascade Delete Story',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.3, lng: 9.3 } }),
      },
      scrapeRun: {
        query: 'cascade run',
        status: 'completed',
        tilesTotal: 1,
        tilesCompleted: 1,
        tilesSubdivided: 0,
        placesFound: 1,
        placesUnique: 1,
      },
      tiles: [
        {
          bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.15, lng: 9.15 } }),
          zoomLevel: 9,
          status: 'completed',
          resultCount: 1,
        },
      ],
      places: [
        {
          id: 'cascade-place-1',
          googleMapsUri: 'https://maps.google.com/?cid=cascade-place-1',
          name: 'Cascade Place',
          lat: 40.1,
          lng: 9.1,
        },
      ],
    })

    const deleteResponse = await request.delete(`/api/projects/${seeded.projectId}`)
    expect(deleteResponse.status()).toBe(204)

    const projectsResponse = await request.get('/api/projects')
    expect(projectsResponse.ok()).toBeTruthy()
    const projects = await projectsResponse.json() as Array<{ id: string }>
    expect(projects).toEqual([])

    const placesResponse = await request.get(`/api/places?projectId=${encodeURIComponent(seeded.projectId)}`)
    expect(placesResponse.ok()).toBeTruthy()
    const places = await placesResponse.json() as Array<{ id: string }>
    expect(places).toEqual([])

    await page.goto('/projects')
    await expect(page.getByTestId(`project-card-${seeded.projectId}`)).toHaveCount(0)
    await captureStepScreenshot(page, testInfo, 'resilience-cascade-delete')
  })

  test('favorite button can be toggled off and returns to outlined icon', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Favorite Toggle Story',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.2, lng: 9.2 } }),
      },
      places: [
        {
          id: 'favorite-toggle-place-1',
          googleMapsUri: 'https://maps.google.com/?cid=favorite-toggle-place-1',
          name: 'Favorite Toggle Place',
          lat: 40.1,
          lng: 9.1,
        },
      ],
    })

    await page.goto(`/projects/${seeded.projectId}/explorer`)
    const favoriteButton = page
      .getByTestId('explorer-row-favorite-toggle-place-1')
      .getByRole('button', { name: /toggle favorite/i })

    await favoriteButton.click()
    await expect(favoriteButton).toHaveAttribute('aria-pressed', 'true')
    await expect(favoriteButton).toHaveText('★')

    await favoriteButton.click()
    await expect(favoriteButton).toHaveAttribute('aria-pressed', 'false')
    await expect(favoriteButton).toHaveText('☆')
    await captureStepScreenshot(page, testInfo, 'resilience-favorite-toggle-off')
  })

  test('rating sort is stable for ties using alphabetical name tiebreaker', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Sort Stability Story',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.4, lng: 9.4 } }),
      },
      places: [
        {
          id: 'sort-stability-zulu',
          googleMapsUri: 'https://maps.google.com/?cid=sort-stability-zulu',
          name: 'Zulu Stay',
          rating: 4.5,
          lat: 40.1,
          lng: 9.1,
        },
        {
          id: 'sort-stability-alpha',
          googleMapsUri: 'https://maps.google.com/?cid=sort-stability-alpha',
          name: 'Alpha Stay',
          rating: 4.5,
          lat: 40.2,
          lng: 9.2,
        },
        {
          id: 'sort-stability-bravo',
          googleMapsUri: 'https://maps.google.com/?cid=sort-stability-bravo',
          name: 'Bravo Stay',
          rating: 4.5,
          lat: 40.3,
          lng: 9.3,
        },
      ],
    })

    await page.goto(`/projects/${seeded.projectId}/explorer`)
    await page.getByRole('button', { name: /^rating/i }).click()

    const rowNames = await readVisibleExplorerRowNames(page)
    expect(rowNames).toEqual(['Alpha Stay', 'Bravo Stay', 'Zulu Stay'])
    await captureStepScreenshot(page, testInfo, 'resilience-sort-stability')
  })

  test('clicking the same sort header toggles direction and reverses row order', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Sort Direction Story',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.4, lng: 9.4 } }),
      },
      places: [
        {
          id: 'sort-direction-alpha',
          googleMapsUri: 'https://maps.google.com/?cid=sort-direction-alpha',
          name: 'Alpha Point',
          lat: 40.1,
          lng: 9.1,
        },
        {
          id: 'sort-direction-bravo',
          googleMapsUri: 'https://maps.google.com/?cid=sort-direction-bravo',
          name: 'Bravo Point',
          lat: 40.2,
          lng: 9.2,
        },
        {
          id: 'sort-direction-charlie',
          googleMapsUri: 'https://maps.google.com/?cid=sort-direction-charlie',
          name: 'Charlie Point',
          lat: 40.3,
          lng: 9.3,
        },
      ],
    })

    await page.goto(`/projects/${seeded.projectId}/explorer`)
    const nameSortButton = page.getByRole('button', { name: /^name/i })

    await nameSortButton.click()
    await expect(nameSortButton).toContainText('↑')
    const ascendingNames = await readVisibleExplorerRowNames(page)

    await nameSortButton.click()
    await expect(nameSortButton).toContainText('↓')
    const descendingNames = await readVisibleExplorerRowNames(page)

    expect(descendingNames).toEqual([...ascendingNames].reverse())
    await captureStepScreenshot(page, testInfo, 'resilience-sort-direction-toggle')
  })
})

const createDeferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve = () => {}
  const promise = new Promise<void>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

const requireScrapeRunId = (scrapeRunId: string | null, label: string): string => {
  if (!scrapeRunId) {
    throw new Error(`Missing scrapeRunId for ${label}`)
  }
  return scrapeRunId
}

const readVisibleExplorerRowNames = async (page: Page): Promise<string[]> => {
  const names = await page.locator('tr[data-testid^="explorer-row-"] > td:first-child').allTextContents()
  return names.map((name) => name.trim()).filter((name) => name.length > 0)
}
