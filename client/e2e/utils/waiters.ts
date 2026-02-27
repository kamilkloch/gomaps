import { expect } from '../fixtures/base'
import type { Locator, Page } from '@playwright/test'

export async function waitForNetworkIdle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
}

export async function waitForVisible(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
}
