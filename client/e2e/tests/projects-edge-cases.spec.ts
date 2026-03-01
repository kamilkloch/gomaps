import { expect, test } from '../fixtures/base'
import { captureStepScreenshot } from '../utils/screenshots'
import { seedFixtures } from '../utils/test-backdoor'
import type { Page } from '@playwright/test'

const mapsKeyForE2E = (process.env.VITE_GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? '').trim()
const shouldExpectInteractiveMapPreview = mapsKeyForE2E.length > 0
  && mapsKeyForE2E !== 'your_google_maps_api_key_here'
  && mapsKeyForE2E !== 'your_key_here'

interface CreatedProject {
  id: string
  name: string
}

test.describe('projects page edge-case story boards', () => {
  test('renders aggregate status/metrics variants for draft, running, paused, failed, and complete cards', async ({ page, request }, testInfo) => {
    const draftSeed = await seedFixtures(request, {
      project: {
        name: 'Status Draft',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.2, lng: 9.2 } }),
      },
    })

    const runningSeed = await seedFixtures(request, {
      project: {
        name: 'Status Running',
        bounds: JSON.stringify({ sw: { lat: 40.2, lng: 9.2 }, ne: { lat: 40.4, lng: 9.4 } }),
      },
      scrapeRun: {
        status: 'running',
        tilesTotal: 8,
        tilesCompleted: 3,
        placesFound: 2,
        placesUnique: 2,
      },
      places: [
        {
          id: 'status-running-1',
          googleMapsUri: 'https://maps.google.com/?cid=status-running-1',
          name: 'Running Hotel',
          lat: 40.31,
          lng: 9.31,
        },
        {
          id: 'status-running-2',
          googleMapsUri: 'https://maps.google.com/?cid=status-running-2',
          name: 'Running Villa',
          lat: 40.32,
          lng: 9.32,
        },
      ],
    })

    const pausedSeed = await seedFixtures(request, {
      project: {
        name: 'Status Paused',
        bounds: JSON.stringify({ sw: { lat: 40.4, lng: 9.4 }, ne: { lat: 40.6, lng: 9.6 } }),
      },
      scrapeRun: {
        status: 'paused',
        tilesTotal: 6,
        tilesCompleted: 2,
        placesFound: 1,
        placesUnique: 1,
      },
      places: [
        {
          id: 'status-paused-1',
          googleMapsUri: 'https://maps.google.com/?cid=status-paused-1',
          name: 'Paused Lodge',
          lat: 40.51,
          lng: 9.51,
        },
      ],
    })

    const failedSeed = await seedFixtures(request, {
      project: {
        name: 'Status Failed',
        bounds: JSON.stringify({ sw: { lat: 40.6, lng: 9.6 }, ne: { lat: 40.8, lng: 9.8 } }),
      },
      scrapeRun: {
        status: 'failed',
        tilesTotal: 4,
        tilesCompleted: 1,
        placesFound: 1,
        placesUnique: 1,
      },
      places: [
        {
          id: 'status-failed-1',
          googleMapsUri: 'https://maps.google.com/?cid=status-failed-1',
          name: 'Failed Inn',
          lat: 40.71,
          lng: 9.71,
        },
      ],
    })

    const completeSeed = await seedFixtures(request, {
      project: {
        name: 'Status Complete',
        bounds: JSON.stringify({ sw: { lat: 40.8, lng: 9.8 }, ne: { lat: 41.0, lng: 10.0 } }),
      },
      scrapeRun: {
        status: 'completed',
        tilesTotal: 5,
        tilesCompleted: 5,
        placesFound: 3,
        placesUnique: 3,
      },
      places: [
        {
          id: 'status-complete-1',
          googleMapsUri: 'https://maps.google.com/?cid=status-complete-1',
          name: 'Complete Stay 1',
          lat: 40.91,
          lng: 9.91,
        },
        {
          id: 'status-complete-2',
          googleMapsUri: 'https://maps.google.com/?cid=status-complete-2',
          name: 'Complete Stay 2',
          lat: 40.92,
          lng: 9.92,
        },
        {
          id: 'status-complete-3',
          googleMapsUri: 'https://maps.google.com/?cid=status-complete-3',
          name: 'Complete Stay 3',
          lat: 40.93,
          lng: 9.93,
        },
      ],
    })

    await page.goto('/projects')
    await captureStepScreenshot(page, testInfo, 'projects-status-aggregates')

    await expectProjectCardSummary(page, draftSeed.projectId, {
      statusLabel: 'Draft',
      statusClass: 'project-status-draft',
      placesCount: 0,
      runsCount: 0,
      expectsNeverLastScraped: true,
    })
    await expectProjectCardSummary(page, runningSeed.projectId, {
      statusLabel: 'Running',
      statusClass: 'project-status-running',
      placesCount: 2,
      runsCount: 1,
      expectsNeverLastScraped: false,
    })
    await expectProjectCardSummary(page, pausedSeed.projectId, {
      statusLabel: 'Paused',
      statusClass: 'project-status-paused',
      placesCount: 1,
      runsCount: 1,
      expectsNeverLastScraped: false,
    })
    await expectProjectCardSummary(page, failedSeed.projectId, {
      statusLabel: 'Failed',
      statusClass: 'project-status-failed',
      placesCount: 1,
      runsCount: 1,
      expectsNeverLastScraped: false,
    })
    await expectProjectCardSummary(page, completeSeed.projectId, {
      statusLabel: 'Complete',
      statusClass: 'project-status-complete',
      placesCount: 3,
      runsCount: 1,
      expectsNeverLastScraped: false,
    })
  })

  test('renders map preview when key is configured, otherwise shows fallback copy', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Map Preview Project',
        bounds: JSON.stringify({ sw: { lat: 41.0, lng: 10.0 }, ne: { lat: 41.2, lng: 10.2 } }),
      },
    })

    await page.goto('/projects')

    const mapPreview = page.getByTestId(`project-map-preview-${seeded.projectId}`)
    await expect(mapPreview).toBeVisible()

    if (shouldExpectInteractiveMapPreview) {
      await expect(mapPreview.locator('.gm-style').first()).toBeVisible({ timeout: 20_000 })
    }
    else {
      await expect(page.getByTestId(`project-map-fallback-${seeded.projectId}`)).toContainText('Google Maps preview unavailable')
    }

    await captureStepScreenshot(page, testInfo, 'projects-map-preview-mode')
  })

  test('hovering different cards updates selected copy and selected glow class', async ({ page, request }, testInfo) => {
    const firstSeed = await seedFixtures(request, {
      project: {
        name: 'Hover Project One',
        bounds: JSON.stringify({ sw: { lat: 41.3, lng: 10.3 }, ne: { lat: 41.5, lng: 10.5 } }),
      },
    })
    const secondSeed = await seedFixtures(request, {
      project: {
        name: 'Hover Project Two',
        bounds: JSON.stringify({ sw: { lat: 41.5, lng: 10.5 }, ne: { lat: 41.7, lng: 10.7 } }),
      },
    })

    await page.goto('/projects')

    const firstCard = page.getByTestId(`project-card-${firstSeed.projectId}`)
    const secondCard = page.getByTestId(`project-card-${secondSeed.projectId}`)
    await expect(firstCard).toBeVisible()
    await expect(secondCard).toBeVisible()

    await firstCard.hover()
    await expect(firstCard).toHaveClass(/is-selected/)
    await expect(page.getByTestId('projects-selected-copy')).toContainText('Selected: Hover Project One')

    await secondCard.hover()
    await expect(secondCard).toHaveClass(/is-selected/)
    await expect(firstCard).not.toHaveClass(/is-selected/)
    await expect(page.getByTestId('projects-selected-copy')).toContainText('Selected: Hover Project Two')

    await captureStepScreenshot(page, testInfo, 'projects-hover-selection')
  })

  test('newly created projects render in deterministic newest-first creation order', async ({ page }, testInfo) => {
    await page.goto('/projects')

    const createdProjects: CreatedProject[] = []
    createdProjects.push(await createProjectViaUi(page, `Ordering Alpha ${Date.now()}`))
    createdProjects.push(await createProjectViaUi(page, `Ordering Beta ${Date.now()}`))
    createdProjects.push(await createProjectViaUi(page, `Ordering Gamma ${Date.now()}`))

    const expectedOrder = [...createdProjects].reverse().map((project) => project.id)
    const renderedOrder = await page.locator('[data-testid^="project-card-"]').evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('data-testid')?.replace('project-card-', ''))
        .filter((value): value is string => Boolean(value))
    )

    expect(renderedOrder.slice(0, 3)).toEqual(expectedOrder)
    await captureStepScreenshot(page, testInfo, 'projects-ordering')
  })

  test('rapid create then immediate delete removes the transient project cleanly', async ({ page }, testInfo) => {
    await page.goto('/projects')
    const created = await createProjectViaUi(page, `Rapid Cycle ${Date.now()}`)

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByTestId(`project-delete-${created.id}`).click()

    await expect(page.getByTestId(`project-card-${created.id}`)).toHaveCount(0)
    await expect(page.getByTestId('projects-error')).toHaveCount(0)
    await captureStepScreenshot(page, testInfo, 'projects-rapid-create-delete')
  })

  test('duplicate project names can be created without dropping either card', async ({ page }, testInfo) => {
    await page.goto('/projects')
    const duplicateName = `Duplicate Name ${Date.now()}`

    await createProjectViaUi(page, duplicateName)
    await createProjectViaUi(page, duplicateName)

    await expect(page.getByRole('heading', { name: duplicateName })).toHaveCount(2)
    await captureStepScreenshot(page, testInfo, 'projects-duplicate-names')
  })
})

async function createProjectViaUi(page: Page, name: string): Promise<CreatedProject> {
  await page.getByTestId('projects-new-button').click()
  await page.getByTestId('projects-create-name-input').fill(name)

  const createResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/projects')
    && response.request().method() === 'POST'
    && response.status() === 201
  )

  await page.getByTestId('projects-create-submit').click()
  const createResponse = await createResponsePromise
  const created = await createResponse.json() as { id: string }

  await expect(page.getByTestId(`project-card-${created.id}`)).toBeVisible()

  return {
    id: created.id,
    name,
  }
}

async function expectProjectCardSummary(
  page: Page,
  projectId: string,
  options: {
    statusLabel: string
    statusClass: string
    placesCount: number
    runsCount: number
    expectsNeverLastScraped: boolean
  },
): Promise<void> {
  const statusBadge = page.getByTestId(`project-status-${projectId}`)
  await expect(statusBadge).toHaveText(options.statusLabel)
  await expect(statusBadge).toHaveClass(new RegExp(`project-status\\s+${options.statusClass}`))

  await expect(page.getByTestId(`project-places-${projectId}`)).toHaveText(`Places: ${options.placesCount}`)
  await expect(page.getByTestId(`project-runs-${projectId}`)).toHaveText(`Scrape runs: ${options.runsCount}`)

  const lastScraped = page.getByTestId(`project-last-scraped-${projectId}`)
  if (options.expectsNeverLastScraped) {
    await expect(lastScraped).toHaveText('Last scraped: never')
    return
  }

  await expect(lastScraped).not.toHaveText('Last scraped: never')
}
