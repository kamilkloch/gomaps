import { expect } from '../fixtures/base'
import type { Locator, Page } from '@playwright/test'

export async function waitForNetworkIdle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
}

export async function waitForVisible(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
}

export async function expectGoogleMapRendered(page: Page, mapShellTestId: string, fallbackTestId: string): Promise<void> {
  const fallback = page.getByTestId(fallbackTestId)
  if (await fallback.count()) {
    await expect(fallback).not.toBeVisible()
  }

  await expect(page.locator(`[data-testid="${mapShellTestId}"] .gm-style`)).toBeVisible({ timeout: 20_000 })
}

export async function panGoogleMap(page: Page, mapShellTestId: string): Promise<void> {
  const mapRoot = page.locator(`[data-testid="${mapShellTestId}"] .gm-style`).first()
  await expect(mapRoot).toBeVisible({ timeout: 20_000 })

  const bounds = await mapRoot.boundingBox()
  if (!bounds) {
    throw new Error(`Unable to pan map in ${mapShellTestId}; missing bounding box`)
  }

  const startX = bounds.x + bounds.width * 0.65
  const startY = bounds.y + bounds.height * 0.55
  const endX = bounds.x + bounds.width * 0.35
  const endY = bounds.y + bounds.height * 0.45

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(endX, endY)
  await page.mouse.up()
}
