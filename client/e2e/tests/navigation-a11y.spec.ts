import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../fixtures/base'
import { captureStepScreenshot } from '../utils/screenshots'
import { seedFixtures } from '../utils/test-backdoor'

interface ProjectSummaryForSelection {
  id: string
}

test.describe('navigation, routing, and accessibility story-boards', () => {
  test('redirects and deep links resolve correctly for setup and explorer', async ({ page, request }, testInfo) => {
    const firstSeed = await seedFixtures(request, {
      project: {
        name: 'Routing First Project',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.2, lng: 9.2 } }),
      },
      places: [
        {
          id: 'routing-place-first',
          googleMapsUri: 'https://maps.google.com/?cid=routing-place-first',
          name: 'Routing Place First',
          lat: 40.1,
          lng: 9.1,
        },
      ],
    })

    const secondSeed = await seedFixtures(request, {
      project: {
        name: 'Routing Second Project',
        bounds: JSON.stringify({ sw: { lat: 40.3, lng: 9.3 }, ne: { lat: 40.6, lng: 9.6 } }),
      },
      places: [
        {
          id: 'routing-place-second-1',
          googleMapsUri: 'https://maps.google.com/?cid=routing-place-second-1',
          name: 'Routing Place Second 1',
          lat: 40.4,
          lng: 9.4,
        },
        {
          id: 'routing-place-second-2',
          googleMapsUri: 'https://maps.google.com/?cid=routing-place-second-2',
          name: 'Routing Place Second 2',
          lat: 40.45,
          lng: 9.45,
        },
      ],
    })

    const projectCountById: Record<string, number> = {
      [firstSeed.projectId]: 1,
      [secondSeed.projectId]: 2,
    }

    const projectsResponse = await request.get('/api/projects')
    expect(projectsResponse.ok()).toBeTruthy()
    const projects = await projectsResponse.json() as ProjectSummaryForSelection[]
    const expectedFirstProjectId = projects[0]?.id
    if (!expectedFirstProjectId) {
      throw new Error('Expected at least one project for /explorer auto-selection test')
    }

    await page.goto('/setup')
    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.getByTestId('projects-page')).toBeVisible()
    await expect(page.getByTestId('nav-avatar')).toHaveText('U')
    await captureStepScreenshot(page, testInfo, 'navigation-redirect-setup-to-projects')

    await page.goto('/explorer')
    await expect(page).toHaveURL(/\/explorer$/)
    await expect(page.getByTestId('explorer-page')).toBeVisible()
    await expect(page.getByTestId('explorer-project-select')).toHaveValue(expectedFirstProjectId)
    await expect(page.getByTestId('explorer-table-count')).toContainText(`${projectCountById[expectedFirstProjectId]} places`)
    await captureStepScreenshot(page, testInfo, 'navigation-bare-explorer-auto-select')

    await page.goto('/projects/nonexistent/setup')
    await expect(page.getByTestId('setup-page')).toContainText('Project not found.')
    await captureStepScreenshot(page, testInfo, 'navigation-invalid-setup-deep-link')

    await page.goto(`/projects/${firstSeed.projectId}/explorer`)
    await expect(page).toHaveURL(new RegExp(`/projects/${firstSeed.projectId}/explorer$`))
    await expect(page.getByTestId('explorer-project-select')).toHaveValue(firstSeed.projectId)
    await expect(page.getByTestId('explorer-table-count')).toContainText('1 places')
    await captureStepScreenshot(page, testInfo, 'navigation-valid-explorer-deep-link')
  })

  test('nav active styles and browser back-forward transitions remain correct', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'History Navigation Project',
        bounds: JSON.stringify({ sw: { lat: 41.0, lng: 10.0 }, ne: { lat: 41.3, lng: 10.3 } }),
      },
      places: [
        {
          id: 'history-place',
          googleMapsUri: 'https://maps.google.com/?cid=history-place',
          name: 'History Place',
          lat: 41.1,
          lng: 10.1,
        },
      ],
    })

    await page.goto('/projects')
    await expect(page.getByTestId('nav-avatar')).toHaveText('U')
    await expectActiveNavLink(page.getByTestId('nav-projects'))

    await page.getByTestId(`project-card-${seeded.projectId}`).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${seeded.projectId}/setup$`))
    await expect(page.getByTestId('setup-page')).toBeVisible()

    await page.getByTestId('nav-explorer').click()
    await expect(page).toHaveURL(/\/explorer$/)
    await expect(page.getByTestId('explorer-page')).toBeVisible()
    await expectActiveNavLink(page.getByTestId('nav-explorer'))
    await captureStepScreenshot(page, testInfo, 'navigation-history-explorer')

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/projects/${seeded.projectId}/setup$`))
    await expect(page.getByTestId('setup-page')).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(/\/projects$/)
    await expect(page.getByTestId('projects-page')).toBeVisible()

    await page.goForward()
    await expect(page).toHaveURL(new RegExp(`/projects/${seeded.projectId}/setup$`))
    await expect(page.getByTestId('setup-page')).toBeVisible()

    await page.goForward()
    await expect(page).toHaveURL(/\/explorer$/)
    await expect(page.getByTestId('explorer-page')).toBeVisible()
  })

  test('landmarks and keyboard-only explorer row selection are accessible', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Keyboard A11y Project',
        bounds: JSON.stringify({ sw: { lat: 39.8, lng: 8.8 }, ne: { lat: 40.2, lng: 9.2 } }),
      },
      places: [
        {
          id: 'keyboard-row-one',
          googleMapsUri: 'https://maps.google.com/?cid=keyboard-row-one',
          name: 'Keyboard Row One',
          lat: 39.9,
          lng: 8.9,
        },
        {
          id: 'keyboard-row-two',
          googleMapsUri: 'https://maps.google.com/?cid=keyboard-row-two',
          name: 'Keyboard Row Two',
          lat: 40.0,
          lng: 9.0,
        },
      ],
    })

    await page.goto('/projects')
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByTestId('projects-list-region')).toHaveAttribute('aria-label', 'Projects list')
    await expect(page.getByTestId(`project-card-${seeded.projectId}`)).toHaveAttribute('role', 'button')

    await page.getByTestId(`project-card-${seeded.projectId}`).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${seeded.projectId}/setup$`))
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByTestId('setup-map-panel')).toHaveAttribute('role', 'region')
    await expect(page.getByTestId('setup-map-panel')).toHaveAttribute('aria-label', 'Setup map panel')

    await page.getByTestId('nav-explorer').click()
    await expect(page).toHaveURL(/\/explorer$/)
    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByTestId('explorer-map-panel')).toHaveAttribute('aria-label', 'Explorer map panel')
    await expect(page.getByTestId('explorer-table-panel')).toHaveAttribute('aria-label', 'Explorer table panel')

    const firstRow = page.getByTestId('explorer-row-keyboard-row-one')
    const targetRow = page.getByTestId('explorer-row-keyboard-row-two')
    await expect(firstRow).toBeVisible()
    await expect(targetRow).toBeVisible()

    await firstRow.click()
    await expect(firstRow).toHaveAttribute('data-selected', 'true')
    await expect(targetRow).toHaveAttribute('data-selected', 'false')

    await firstRow.focus()
    await focusWithTab(page, targetRow)
    await expect(targetRow).toBeFocused()
    await expect(targetRow).toHaveCSS('outline-style', 'solid')
    await expect(targetRow).toHaveCSS('outline-color', 'rgb(89, 168, 255)')

    await page.keyboard.press('Enter')
    await expect(targetRow).toHaveAttribute('data-selected', 'true')
    await expect(page.getByTestId('explorer-detail-name')).toHaveText('Keyboard Row Two')
    await captureStepScreenshot(page, testInfo, 'navigation-a11y-keyboard-row-selection')
  })
})

async function expectActiveNavLink(locator: Locator): Promise<void> {
  await expect(locator).toHaveCSS('font-weight', '700')
  await expect(locator).toHaveCSS('color', 'rgb(26, 115, 232)')
}

async function focusWithTab(page: Page, locator: Locator): Promise<void> {
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press('Tab')
    if (await locator.evaluate((element) => element === document.activeElement)) {
      return
    }
  }

  throw new Error('Failed to focus target row via Tab navigation')
}
