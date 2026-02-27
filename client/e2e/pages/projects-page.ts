import { resolveLocator } from '../utils/locators'
import { waitForNetworkIdle, waitForVisible } from '../utils/waiters'
import type { Locator, Page } from '@playwright/test'

class ProjectsPageObject {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/')
    await waitForNetworkIdle(this.page)
  }

  async root(): Promise<Locator> {
    const locator = await resolveLocator(this.page, {
      testId: 'projects-page',
      role: 'main',
      text: 'Projects',
      defectLabel: 'Projects page root container',
    })
    await waitForVisible(locator)
    return locator
  }

  async heading(): Promise<Locator> {
    const locator = await resolveLocator(this.page, {
      testId: 'projects-page-title',
      role: 'heading',
      name: 'Projects',
      text: 'Projects',
      defectLabel: 'Projects page heading',
    })
    await waitForVisible(locator)
    return locator
  }
}

export function createProjectsPage(page: Page): ProjectsPageObject {
  return new ProjectsPageObject(page)
}
