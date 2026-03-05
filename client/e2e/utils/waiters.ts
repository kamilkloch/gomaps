import { expect } from '../fixtures/base'
import type { Locator, Page } from '@playwright/test'

export type GoogleMapRenderMode = 'interactive' | 'fallback'

export async function waitForNetworkIdle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
}

export async function waitForVisible(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
}

export async function expectGoogleMapRendered(
  page: Page,
  mapShellTestId: string,
  fallbackTestId: string,
): Promise<GoogleMapRenderMode> {
  const fallback = page.getByTestId(fallbackTestId)
  if (await fallback.count() && await fallback.first().isVisible()) {
    await expect(fallback).toBeVisible()
    return 'fallback'
  }

  const mapRoot = page.locator(`[data-testid="${mapShellTestId}"] .gm-style`).first()
  try {
    await expect(mapRoot).toBeVisible({ timeout: 20_000 })
    return 'interactive'
  }
  catch {
    return 'fallback'
  }
}

export async function expectGoogleMapHasContent(page: Page, mapShellTestId: string): Promise<void> {
  const mapShell = page.getByTestId(mapShellTestId)
  const interactiveMap = mapShell.locator('.gm-style').first()
  await expect(interactiveMap).toBeVisible({ timeout: 20_000 })

  const renderedTileMedia = mapShell.locator('.gm-style img, .gm-style canvas').first()
  await expect(renderedTileMedia).toBeVisible({ timeout: 20_000 })
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

interface DrawAreaOnGoogleMapOptions {
  startXRatio?: number
  startYRatio?: number
  endXRatio?: number
  endYRatio?: number
}

export async function drawAreaOnGoogleMap(
  page: Page,
  mapShellTestId: string,
  options: DrawAreaOnGoogleMapOptions = {},
): Promise<void> {
  const mapRoot = page.locator(`[data-testid="${mapShellTestId}"] .gm-style`).first()
  await expect(mapRoot).toBeVisible({ timeout: 20_000 })

  const bounds = await mapRoot.boundingBox()
  if (!bounds) {
    throw new Error(`Unable to draw area in ${mapShellTestId}; missing bounding box`)
  }

  const startX = bounds.x + bounds.width * (options.startXRatio ?? 0.28)
  const startY = bounds.y + bounds.height * (options.startYRatio ?? 0.34)
  const endX = bounds.x + bounds.width * (options.endXRatio ?? 0.72)
  const endY = bounds.y + bounds.height * (options.endYRatio ?? 0.68)

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(endX, endY, { steps: 14 })
  await page.mouse.up()
}

interface MoveSelectionRectangleOnGoogleMapOptions {
  startXRatio?: number
  startYRatio?: number
  endXRatio?: number
  endYRatio?: number
}

export async function moveSelectionRectangleOnGoogleMap(
  page: Page,
  mapShellTestId: string,
  options: MoveSelectionRectangleOnGoogleMapOptions = {},
): Promise<void> {
  const mapRoot = page.locator(`[data-testid="${mapShellTestId}"] .gm-style`).first()
  await expect(mapRoot).toBeVisible({ timeout: 20_000 })

  const bounds = await mapRoot.boundingBox()
  if (!bounds) {
    throw new Error(`Unable to move selection in ${mapShellTestId}; missing bounding box`)
  }

  const startX = bounds.x + bounds.width * (options.startXRatio ?? 0.5)
  const startY = bounds.y + bounds.height * (options.startYRatio ?? 0.5)
  const endX = bounds.x + bounds.width * (options.endXRatio ?? 0.6)
  const endY = bounds.y + bounds.height * (options.endYRatio ?? 0.58)

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(endX, endY, { steps: 18 })
  await page.mouse.up()
}

export async function getGoogleMapCenter(
  page: Page,
  mapShellTestId: string,
): Promise<{ lat: number; lng: number }> {
  return page.evaluate((testId) => {
    const shell = document.querySelector(`[data-testid="${testId}"]`)
    if (!shell) {
      throw new Error(`Map shell [data-testid="${testId}"] not found`)
    }
    const gmStyle = shell.querySelector('.gm-style') as HTMLElement | null
    if (!gmStyle) {
      throw new Error('No .gm-style element found inside map shell')
    }
    // The __gm property on the .gm-style div holds the internal map reference
    const internal = (gmStyle as unknown as Record<string, unknown>).__gm as
      | { get: (key: string) => google.maps.Map | undefined }
      | undefined
    const mapInstance = internal?.get?.('map')
    if (!mapInstance) {
      throw new Error('Unable to locate google.maps.Map instance')
    }
    const center = mapInstance.getCenter()!
    return { lat: center.lat(), lng: center.lng() }
  }, mapShellTestId)
}
