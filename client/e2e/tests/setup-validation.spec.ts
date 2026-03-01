import { expect, test } from '../fixtures/base'
import { captureStepScreenshot } from '../utils/screenshots'
import { seedFixtures } from '../utils/test-backdoor'
import { expectGoogleMapHasContent, expectGoogleMapRendered } from '../utils/waiters'

test.describe('setup page validation, estimates, and chrome story boards', () => {
  test('estimate badge updates for selected area and resets after clear', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Setup Estimate Story',
        bounds: JSON.stringify({
          sw: { lat: 40.15, lng: 9.15 },
          ne: { lat: 40.45, lng: 9.55 },
        }),
      },
    })

    await page.goto(`/projects/${seeded.projectId}/setup`)
    await expect(page.getByTestId('setup-page')).toBeVisible()
    await expect(page.getByTestId('setup-estimate-badge')).toHaveText(/^~\d+ tiles · Est\. \d+ min$/)
    await captureStepScreenshot(page, testInfo, 'setup-estimate-with-area')

    await page.getByTestId('setup-clear-area-button').click()
    await expect(page.getByTestId('setup-status-copy')).toContainText('No area selected yet.')
    await expect(page.getByTestId('setup-estimate-badge')).toHaveText('Select an area to estimate tiles and timing')
    await captureStepScreenshot(page, testInfo, 'setup-estimate-after-clear')
  })

  test('empty query blocks scrape start and shows validation without firing start request', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Setup Empty Query Story',
        bounds: JSON.stringify({
          sw: { lat: 40.05, lng: 9.05 },
          ne: { lat: 40.35, lng: 9.35 },
        }),
      },
    })

    let startRequests = 0
    await page.route('**/api/scrape/start', async (route) => {
      startRequests += 1
      await route.continue()
    })

    await page.goto(`/projects/${seeded.projectId}/setup`)
    await expect(page.getByTestId('setup-page')).toBeVisible()
    await expect(page.getByTestId('setup-start-scrape-button')).toBeEnabled()

    await page.getByTestId('setup-query-input').fill('   ')
    await page.getByTestId('setup-start-scrape-button').click()

    await expect(page.getByTestId('setup-error')).toContainText('Enter a query before starting a scrape.')
    expect(startRequests).toBe(0)
    await captureStepScreenshot(page, testInfo, 'setup-empty-query-guard')
  })

  test('start scrape button stays disabled when no bounds are selected', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Setup No Bounds Story',
        bounds: '',
      },
    })

    await page.goto(`/projects/${seeded.projectId}/setup`)
    await expect(page.getByTestId('setup-page')).toBeVisible()
    await expect(page.getByTestId('setup-start-scrape-button')).toBeDisabled()
    await captureStepScreenshot(page, testInfo, 'setup-start-disabled-without-bounds')
  })

  test('breadcrumbs show Projects / project name / Setup', async ({ page, request }, testInfo) => {
    const projectName = 'Setup Breadcrumb Story'
    const seeded = await seedFixtures(request, {
      project: {
        name: projectName,
        bounds: '',
      },
    })

    await page.goto(`/projects/${seeded.projectId}/setup`)
    await expect(page.getByTestId('setup-page')).toBeVisible()
    await expect(page.getByTestId('setup-breadcrumbs')).toContainText('Projects')
    await expect(page.getByTestId('setup-breadcrumbs')).toContainText(projectName)
    await expect(page.getByTestId('setup-breadcrumbs')).toContainText('Setup')
    await captureStepScreenshot(page, testInfo, 'setup-breadcrumbs')
  })

  test('previous runs section renders at most 6 run entries even when more exist', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Setup Runs Cap Story',
        bounds: JSON.stringify({
          sw: { lat: 40.0, lng: 9.0 },
          ne: { lat: 40.4, lng: 9.4 },
        }),
      },
      scrapeRun: {
        query: 'cap run 1',
        status: 'completed',
        tilesTotal: 4,
        tilesCompleted: 4,
        placesFound: 9,
        placesUnique: 8,
      },
    })

    for (let index = 2; index <= 8; index += 1) {
      await seedFixtures(request, {
        existingProjectId: seeded.projectId,
        project: {
          name: 'Setup Runs Cap Story',
          bounds: JSON.stringify({
            sw: { lat: 40.0, lng: 9.0 },
            ne: { lat: 40.4, lng: 9.4 },
          }),
        },
        scrapeRun: {
          query: `cap run ${index}`,
          status: 'completed',
          tilesTotal: 5,
          tilesCompleted: 5,
          placesFound: 10 + index,
          placesUnique: 8 + index,
        },
      })
    }

    await page.goto(`/projects/${seeded.projectId}/setup`)
    await expect(page.getByTestId('setup-page')).toBeVisible()
    await expect(page.getByTestId('setup-runs-section').locator('[data-testid^="setup-run-"]')).toHaveCount(6)
    await captureStepScreenshot(page, testInfo, 'setup-runs-capped-at-six')
  })

  test('selected bounds persist across Projects -> Setup navigation round-trip', async ({ page, request }, testInfo) => {
    const projectName = 'Setup Bounds Roundtrip Story'
    const seeded = await seedFixtures(request, {
      project: {
        name: projectName,
        bounds: '',
      },
    })

    await page.goto(`/projects/${seeded.projectId}/setup`)
    await expect(page.getByTestId('setup-page')).toBeVisible()

    const mapMode = await expectGoogleMapRendered(page, 'setup-map-shell', 'setup-map-fallback')
    test.skip(mapMode === 'fallback', 'Round-trip bounds persistence requires interactive Google Maps rendering')

    await expectGoogleMapHasContent(page, 'setup-map-shell')
    const boundsSaveResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/projects/${seeded.projectId}`)
      && response.request().method() === 'PUT'
    )
    await page.getByTestId('setup-select-area-button').click()
    await boundsSaveResponse
    await expect(page.getByTestId('setup-coordinates-pill')).toBeVisible()
    await expect(page.getByTestId('setup-status-copy')).toContainText('Selection saved to project.')
    const coordinatesBeforeNavigation = await page.getByTestId('setup-coordinates-pill').innerText()
    await captureStepScreenshot(page, testInfo, 'setup-bounds-selected')

    await page.goto('/projects')
    await expect(page.getByTestId('projects-page')).toBeVisible()
    await page.getByTestId(`project-card-${seeded.projectId}`).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${seeded.projectId}/setup$`))
    await expect(page.getByTestId('setup-coordinates-pill')).toHaveText(coordinatesBeforeNavigation)
    await captureStepScreenshot(page, testInfo, 'setup-bounds-roundtrip-restored')
  })
})
