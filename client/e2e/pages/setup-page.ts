import { resolveLocator } from '../utils/locators'
import { drawAreaOnGoogleMap, waitForSetupPageReady, waitForVisible } from '../utils/waiters'
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

class SetupPageObject {
  constructor(private readonly page: Page) {}

  async goto(projectId: string): Promise<void> {
    await this.page.goto(`/projects/${projectId}/setup`)
    await waitForSetupPageReady(this.page)
  }

  async root(): Promise<Locator> {
    const locator = await resolveLocator(this.page, {
      testId: 'setup-page',
      role: 'main',
      text: 'Scrape Setup',
      defectLabel: 'Setup page root',
    })
    await waitForVisible(locator)
    return locator
  }

  async clearSelection(): Promise<void> {
    const clearButton = await resolveLocator(this.page, {
      testId: 'setup-clear-area-button',
      role: 'button',
      name: /reset area/i,
      text: 'Reset area',
      defectLabel: 'Setup clear area button',
    })
    await clearButton.click()
  }

  async selectArea(): Promise<void> {
    const selectButton = await resolveLocator(this.page, {
      testId: 'setup-select-area-button',
      role: 'button',
      name: /select/i,
      text: 'Select',
      defectLabel: 'Setup select area button',
    })
    await selectButton.click()

    const drawAttempts = [
      { startXRatio: 0.12, startYRatio: 0.14, endXRatio: 0.42, endYRatio: 0.46 },
      { startXRatio: 0.68, startYRatio: 0.18, endXRatio: 0.92, endYRatio: 0.44 },
    ]

    const startScrapeButton = this.page.getByTestId('setup-start-scrape-button')
    const statusCopy = this.page.getByTestId('setup-status-copy')

    for (const drawAttempt of drawAttempts) {
      await drawAreaOnGoogleMap(this.page, 'setup-map-shell', drawAttempt)
      try {
        await expect(statusCopy).toContainText('Selection saved to project.', { timeout: 1_500 })
        await expect(startScrapeButton).toBeEnabled({ timeout: 1_500 })
        return
      }
      catch {
        // Try an alternative draw region before failing.
      }
    }

    throw new Error('Could not create a selectable scrape area in SetupPage.selectArea()')
  }

  async startScrape(query: string): Promise<void> {
    const queryInput = await resolveLocator(this.page, {
      testId: 'setup-query-input',
      role: 'textbox',
      name: /query/i,
      defectLabel: 'Setup query input',
    })
    await queryInput.fill(query)

    const startButton = await resolveLocator(this.page, {
      testId: 'setup-start-scrape-button',
      role: 'button',
      name: /start scrape/i,
      text: 'Start Scrape',
      defectLabel: 'Setup start scrape button',
    })
    await startButton.click()
  }

  async pauseOrResumeRun(): Promise<void> {
    const pauseButton = await resolveLocator(this.page, {
      testId: 'setup-pause-resume-button',
      role: 'button',
      defectLabel: 'Setup pause resume button',
    })
    await pauseButton.click()
  }
}

export function createSetupPage(page: Page): SetupPageObject {
  return new SetupPageObject(page)
}
