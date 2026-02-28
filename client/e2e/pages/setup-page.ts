import { resolveLocator } from '../utils/locators'
import { waitForNetworkIdle, waitForVisible } from '../utils/waiters'
import type { Locator, Page } from '@playwright/test'

class SetupPageObject {
  constructor(private readonly page: Page) {}

  async goto(projectId: string): Promise<void> {
    await this.page.goto(`/projects/${projectId}/setup`)
    await waitForNetworkIdle(this.page)
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
      name: /clear/i,
      text: 'Clear',
      defectLabel: 'Setup clear area button',
    })
    await clearButton.click()
    await waitForNetworkIdle(this.page)
  }

  async selectArea(): Promise<void> {
    const selectButton = await resolveLocator(this.page, {
      testId: 'setup-select-area-button',
      role: 'button',
      name: /select area/i,
      text: 'Select Area',
      defectLabel: 'Setup select area button',
    })
    await selectButton.click()
    await waitForNetworkIdle(this.page)
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
    await waitForNetworkIdle(this.page)
  }

  async pauseOrResumeRun(): Promise<void> {
    const pauseButton = await resolveLocator(this.page, {
      testId: 'setup-pause-resume-button',
      role: 'button',
      defectLabel: 'Setup pause resume button',
    })
    await pauseButton.click()
    await waitForNetworkIdle(this.page)
  }
}

export function createSetupPage(page: Page): SetupPageObject {
  return new SetupPageObject(page)
}
