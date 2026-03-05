import { expect } from '../fixtures/base'
import type { Locator, Page } from '@playwright/test'

export type GoogleMapRenderMode = 'interactive' | 'fallback'

async function requireSingleLocator(locator: Locator, description: string): Promise<Locator> {
  const count = await locator.count()
  if (count !== 1) {
    throw new Error(`Expected exactly 1 ${description}, found ${count}.`)
  }

  return locator
}

async function requireSingleMapLocator(
  page: Page,
  mapShellTestId: string,
  selector: string,
  description: string,
): Promise<Locator> {
  const mapShell = await requireSingleLocator(page.getByTestId(mapShellTestId), `map shell "${mapShellTestId}"`)
  return requireSingleLocator(mapShell.locator(selector), `${description} inside "${mapShellTestId}"`)
}

export async function waitForProjectsPageReady(page: Page): Promise<void> {
  const pageRoot = page.getByTestId('projects-page')
  await expect(pageRoot).toBeVisible()
  await expect(pageRoot.getByText('Loading projects…')).toHaveCount(0)
}

export async function waitForSetupPageReady(page: Page): Promise<void> {
  const pageRoot = page.getByTestId('setup-page')
  await expect(pageRoot).toBeVisible()
  await expect(pageRoot.getByText('Loading setup…')).toHaveCount(0)
}

export async function waitForExplorerPageReady(page: Page): Promise<void> {
  const pageRoot = page.getByTestId('explorer-page')
  await expect(pageRoot).toBeVisible()
  await expect(pageRoot.getByTestId('explorer-table-count')).not.toContainText('Loading places…')
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
  const mapShell = await requireSingleLocator(page.getByTestId(mapShellTestId), `map shell "${mapShellTestId}"`)
  let resolvedMode: GoogleMapRenderMode | null = null

  await expect.poll(async () => {
    const fallbackCount = await fallback.count()
    if (fallbackCount > 1) {
      throw new Error(`Expected at most one fallback map container "${fallbackTestId}", found ${fallbackCount}.`)
    }

    if (fallbackCount === 1 && await fallback.isVisible()) {
      resolvedMode = 'fallback'
      return 'resolved'
    }

    const mapRoot = mapShell.locator('.gm-style')
    const mapRootCount = await mapRoot.count()
    if (mapRootCount > 1) {
      throw new Error(`Expected exactly 1 Google Maps root inside "${mapShellTestId}", found ${mapRootCount}.`)
    }

    if (mapRootCount === 1 && await mapRoot.isVisible()) {
      resolvedMode = 'interactive'
      return 'resolved'
    }

    return 'pending'
  }, { timeout: 20_000 }).toBe('resolved')

  return resolvedMode ?? 'fallback'
}

export async function expectGoogleMapHasContent(page: Page, mapShellTestId: string): Promise<void> {
  const mapShell = page.getByTestId(mapShellTestId)
  const interactiveMap = await requireSingleMapLocator(page, mapShellTestId, '.gm-style', 'Google Maps root')
  await expect(interactiveMap).toBeVisible({ timeout: 20_000 })

  const renderedTileMedia = mapShell.locator('.gm-style img, .gm-style canvas')
  await expect.poll(async () => renderedTileMedia.count()).toBeGreaterThan(0)
  await expect(renderedTileMedia.nth(0)).toBeVisible({ timeout: 20_000 })
}

export async function panGoogleMap(page: Page, mapShellTestId: string): Promise<void> {
  const mapRoot = await requireSingleMapLocator(page, mapShellTestId, '.gm-style', 'Google Maps root')
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
  const mapRoot = await requireSingleMapLocator(page, mapShellTestId, '.gm-style', 'Google Maps root')
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
  const mapRoot = await requireSingleMapLocator(page, mapShellTestId, '.gm-style', 'Google Maps root')
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
    const explorerDebugController = (
      window as typeof window & {
        __gomapsExplorerDebug?: {
          getCenter?: () => { lat: number; lng: number } | null
        }
      }
    ).__gomapsExplorerDebug
    if (typeof explorerDebugController?.getCenter === 'function') {
      const center = explorerDebugController.getCenter()
      if (!center) {
        throw new Error('Explorer debug controller did not return a map center.')
      }

      return center
    }

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
      | {
        get: (key: string) => {
          getCenter: () => { lat: () => number; lng: () => number } | null | undefined
        } | undefined
      }
      | undefined
    const mapInstance = internal?.get?.('map')
    if (!mapInstance) {
      throw new Error('Unable to locate google.maps.Map instance')
    }
    const center = mapInstance.getCenter()!
    return { lat: center.lat(), lng: center.lng() }
  }, mapShellTestId)
}
