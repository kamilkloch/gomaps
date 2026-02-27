import { resolveLocator } from '../utils/locators'
import { waitForNetworkIdle, waitForVisible } from '../utils/waiters'
import type { Locator, Page } from '@playwright/test'

class ExplorerPageObject {
  constructor(private readonly page: Page) {}

  async goto(projectId: string): Promise<void> {
    await this.page.goto(`/projects/${projectId}/explorer`)
    await waitForNetworkIdle(this.page)
  }

  async root(): Promise<Locator> {
    const locator = await resolveLocator(this.page, {
      testId: 'explorer-page',
      role: 'main',
      text: 'Filters',
      defectLabel: 'Explorer page root',
    })
    await waitForVisible(locator)
    return locator
  }

  async search(value: string): Promise<void> {
    const searchInput = await resolveLocator(this.page, {
      testId: 'explorer-search-input',
      role: 'searchbox',
      name: /search places/i,
      defectLabel: 'Explorer search input',
    })
    await searchInput.fill(value)
  }

  async selectProject(projectId: string): Promise<void> {
    const selector = await resolveLocator(this.page, {
      testId: 'explorer-project-select',
      role: 'combobox',
      name: /project/i,
      defectLabel: 'Explorer project selector',
    })
    await selector.selectOption(projectId)
    await waitForNetworkIdle(this.page)
  }

  async clickRow(placeId: string): Promise<void> {
    const row = await resolveLocator(this.page, {
      testId: `explorer-row-${placeId}`,
      role: 'row',
      defectLabel: `Explorer row for ${placeId}`,
    })
    await row.click()
  }
}

export function createExplorerPage(page: Page): ExplorerPageObject {
  return new ExplorerPageObject(page)
}
