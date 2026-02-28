import { expect, test } from '../fixtures/base'
import { createProjectsPage } from '../pages/projects-page'
import { createSetupPage } from '../pages/setup-page'
import { captureStepScreenshot } from '../utils/screenshots'
import { seedFixtures } from '../utils/test-backdoor'
import { expectGoogleMapRendered, panGoogleMap } from '../utils/waiters'

test.describe('ui component interaction coverage', () => {
  test('projects page supports mouse + keyboard create/open/delete flows', async ({ page }, testInfo) => {
    const projectsPage = createProjectsPage(page)
    await projectsPage.goto()
    await captureStepScreenshot(page, testInfo, 'projects-initial')

    await expect(page.getByTestId('app-nav')).toBeVisible()
    await expect(page.getByTestId('nav-avatar')).toBeVisible()

    await page.getByTestId('projects-empty-create-button').click()
    await expect(page.getByTestId('projects-create-form')).toBeVisible()

    const firstCreateResponse = page.waitForResponse((response) =>
      response.url().includes('/api/projects')
      && response.request().method() === 'POST'
      && response.status() === 201
    )
    await page.getByTestId('projects-create-name-input').fill('Keyboard Project')
    await page.getByTestId('projects-create-name-input').press('Enter')
    await firstCreateResponse

    const keyboardCard = page.locator('[data-testid^="project-card-"]').first()
    await expect(keyboardCard).toBeVisible()
    await keyboardCard.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/projects\/[^/]+\/setup$/)

    await page.getByTestId('nav-projects').click()
    await expect(page).toHaveURL(/\/projects$/)

    await page.getByTestId('projects-new-button').click()
    await page.getByTestId('projects-create-name-input').fill('Mouse Project')
    const secondCreateResponse = page.waitForResponse((response) =>
      response.url().includes('/api/projects')
      && response.request().method() === 'POST'
      && response.status() === 201
    )
    await page.getByTestId('projects-create-submit').click()
    await secondCreateResponse

    await expect(page.getByRole('heading', { name: 'Mouse Project' })).toBeVisible()
    const mouseCard = page.locator('[data-testid^="project-card-"]').filter({ has: page.getByText('Mouse Project') }).first()
    const mouseCardId = (await mouseCard.getAttribute('data-testid'))?.replace('project-card-', '')
    if (!mouseCardId) {
      throw new Error('Could not resolve mouse-created project id')
    }

    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByTestId(`project-delete-${mouseCardId}`).click()
    await expect(mouseCard).toBeVisible()

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByTestId(`project-delete-${mouseCardId}`).click()
    await expect(page.getByTestId(`project-card-${mouseCardId}`)).toHaveCount(0)
    await captureStepScreenshot(page, testInfo, 'projects-after-delete')
  })

  test('setup page covers area, query, launch, runs, and pause controls', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Setup Coverage Project',
        bounds: JSON.stringify({ sw: { lat: 40.1, lng: 9.1 }, ne: { lat: 40.45, lng: 9.55 } }),
      },
      scrapeRun: {
        query: 'running run',
        status: 'running',
        tilesTotal: 6,
        tilesCompleted: 2,
        tilesSubdivided: 1,
        placesFound: 10,
        placesUnique: 8,
      },
      tiles: [
        {
          bounds: JSON.stringify({ sw: { lat: 40.1, lng: 9.1 }, ne: { lat: 40.2, lng: 9.2 } }),
          zoomLevel: 9,
          status: 'completed',
          resultCount: 3,
        },
      ],
    })

    const setupPage = createSetupPage(page)
    await setupPage.goto(seeded.projectId)
    await captureStepScreenshot(page, testInfo, 'setup-initial')

    await expect(page.getByTestId('setup-page').getByText('Projects')).toBeVisible()
    await expect(page.getByTestId('setup-runs-section')).toContainText('running run')
    await expect(page.getByTestId('setup-progress-section')).toBeVisible()

    const mapMode = await expectGoogleMapRendered(page, 'setup-map-shell', 'setup-map-fallback')
    if (mapMode === 'interactive') {
      await setupPage.selectArea()
      await expect(page.getByTestId('setup-coordinates-pill')).toBeVisible()
      const firstCoordinates = await page.getByTestId('setup-coordinates-pill').textContent()

      await panGoogleMap(page, 'setup-map-shell')
      await setupPage.selectArea()
      const secondCoordinates = await page.getByTestId('setup-coordinates-pill').textContent()
      expect(firstCoordinates).not.toEqual(secondCoordinates)
    }

    await setupPage.clearSelection()
    await expect(page.getByTestId('setup-status-copy')).toContainText('No area selected yet.')

    await page.getByTestId('setup-query-input').click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('keyboard friendly query')
    await expect(page.getByTestId('setup-query-input')).toHaveValue('keyboard friendly query')

    if (mapMode === 'interactive') {
      await setupPage.selectArea()
      const startResponse = page.waitForResponse((response) =>
        response.url().includes('/api/scrape/start')
        && response.request().method() === 'POST'
      )
      await page.getByTestId('setup-start-scrape-button').click()
      await expect((await startResponse).status()).toBe(202)
    }

    const pauseResponse = page.waitForResponse((response) =>
      response.url().includes(`/api/scrape/${seeded.scrapeRunId}/pause`)
      && response.request().method() === 'POST'
    )
    await page.getByTestId('setup-pause-resume-button').click()
    await expect((await pauseResponse).status()).toBe(202)
    await captureStepScreenshot(page, testInfo, 'setup-after-controls')
  })

  test('explorer exercises search, sort, filters, row selection, favorites, and virtualization', async ({ page, request }, testInfo) => {
    const firstProject = await seedFixtures(request, {
      project: {
        name: 'Explorer Main Project',
        bounds: JSON.stringify({ sw: { lat: 39.9, lng: 8.9 }, ne: { lat: 40.8, lng: 9.8 } }),
      },
      places: Array.from({ length: 50 }, (_, index) => ({
        id: `main-place-${index}`,
        googleMapsUri: `https://maps.google.com/?cid=${index}`,
        name: `Main Place ${index}`,
        category: index % 2 === 0 ? 'Hotel' : 'B&B',
        rating: 3.5 + ((index % 15) * 0.1),
        reviewCount: 50 + index,
        priceLevel: index % 3 === 0 ? '$$$' : '$$',
        website: index % 2 === 0 ? `https://direct-${index}.example` : `https://booking.com/${index}`,
        websiteType: index % 2 === 0 ? 'direct' : 'ota',
        address: `Main Street ${index}`,
        lat: 40.0 + (index * 0.002),
        lng: 9.0 + (index * 0.002),
        photoUrls: [`https://example.com/${index}.jpg`],
        amenities: ['Pool', 'WiFi'],
      })),
    })

    const secondProject = await seedFixtures(request, {
      project: {
        name: 'Explorer Secondary Project',
        bounds: JSON.stringify({ sw: { lat: 41.0, lng: 10.0 }, ne: { lat: 41.3, lng: 10.3 } }),
      },
      places: [
        {
          id: 'secondary-place-1',
          googleMapsUri: 'https://maps.google.com/?cid=secondary',
          name: 'Secondary Harbor Hotel',
          category: 'Hotel',
          rating: 4.9,
          reviewCount: 430,
          priceLevel: '$$$$',
          website: 'https://secondary-hotel.example',
          websiteType: 'direct',
          address: 'Secondary Harbor',
          lat: 41.1,
          lng: 10.1,
          photoUrls: ['https://example.com/secondary.jpg'],
          amenities: ['Pool', 'Spa'],
        },
      ],
    })

    await page.goto(`/projects/${firstProject.projectId}/explorer`)
    await expect(page.getByTestId('explorer-page')).toBeVisible()
    await captureStepScreenshot(page, testInfo, 'explorer-initial')

    const mapMode = await expectGoogleMapRendered(page, 'explorer-map-panel', 'explorer-map-fallback')
    if (mapMode === 'interactive') {
      await panGoogleMap(page, 'explorer-map-panel')
    }

    await page.getByTestId('explorer-filters-button').click()

    await page.getByTestId('explorer-search-input').fill('Main Place 1')
    await expect(page.getByTestId('explorer-table-count')).toContainText('11 places')
    await page.getByTestId('explorer-search-input').fill('')

    await page.getByTestId('explorer-table-filter-input').fill('Main Street 22')
    await expect(page.getByTestId('explorer-table-count')).toContainText('1 places')
    await page.getByTestId('explorer-table-filter-clear').click()
    await expect(page.getByTestId('explorer-table-count')).toContainText('50 places')

    await page.getByRole('button', { name: /^name/i }).click()
    await page.getByRole('button', { name: /^category/i }).click()
    await page.getByRole('button', { name: /^rating/i }).click()
    await page.getByRole('button', { name: /^reviews/i }).click()
    await page.getByRole('button', { name: /^price/i }).click()
    await page.getByRole('button', { name: /^website/i }).click()
    await page.getByRole('button', { name: /^address/i }).click()

    await page.getByTestId('explorer-table-scroll').evaluate((node) => {
      node.scrollTop = 0
      node.dispatchEvent(new Event('scroll'))
    })
    const firstVisibleRow = page.locator('[data-testid^="explorer-row-main-place-"]').first()
    await expect(firstVisibleRow).toBeVisible()
    const selectedName = (await firstVisibleRow.locator('td').first().textContent())?.trim() ?? ''
    await firstVisibleRow.click()
    await expect(page.getByTestId('explorer-detail-name')).toContainText(selectedName)

    const favoriteButton = firstVisibleRow.getByRole('button', { name: new RegExp(`Toggle favorite for ${selectedName}`) })
    await favoriteButton.click()
    await expect(favoriteButton).toHaveAttribute('aria-pressed', 'true')

    await page.getByTestId('explorer-table-scroll').evaluate((node) => {
      node.scrollTop = 1_300
      node.dispatchEvent(new Event('scroll'))
    })
    await expect(page.getByTestId('explorer-row-main-place-45')).toBeVisible()

    await page.getByTestId('explorer-project-select').selectOption(secondProject.projectId)
    await expect(page).toHaveURL(new RegExp(`/projects/${secondProject.projectId}/explorer$`))
    await expect(page.getByTestId('explorer-table-count')).toContainText('1 places')
    await expect(page.getByTestId('explorer-detail-name')).toContainText('Secondary Harbor Hotel')
    await captureStepScreenshot(page, testInfo, 'explorer-after-interactions')
  })

  test('navigation links reach shortlists and settings placeholders', async ({ page }) => {
    await page.goto('/projects')
    await page.getByTestId('nav-shortlists').click()
    await expect(page).toHaveURL(/\/shortlists$/)
    await expect(page.getByTestId('shortlists-page')).toBeVisible()

    await page.getByTestId('nav-settings').click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByTestId('settings-page')).toBeVisible()
  })
})
