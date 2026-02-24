import { chromium, type BrowserContext, type Page } from 'playwright'
import { Effect } from 'effect'
import {
  createPlace,
  getPlace,
  linkPlaceToScrapeRun,
  createReview,
  updateScrapeRun,
  type CreatePlaceInput,
} from '../db/index.js'
import { ScrapeError } from '../errors.js'
import { appRuntime } from '../runtime.js'
import {
  normalizePlaceUrl,
  parseLatLngFromUrl,
  generatePlaceId,
  randomInt,
  sleep,
} from './utils.js'

export interface ScrapeConfig {
  scrapeRunId: string
  query: string
  bounds?: { sw: [number, number]; ne: [number, number] }
  maxPlaces?: number
  scrollSteps?: number
  headless?: boolean
  delayMs?: number
  reviewLimit?: number
  profileDir?: string
  onProgress?: (progress: ScrapeProgress) => void
}

export interface ScrapeProgress {
  placesFound: number
  placesUnique: number
  currentIndex: number
  totalUrls: number
  status: 'collecting' | 'scraping' | 'paused' | 'completed' | 'failed'
}

export function startScrape(config: ScrapeConfig): Effect.Effect<void, ScrapeError> {
  return Effect.tryPromise({
    try: () => startScrapeImpl(config),
    catch: (e) => new ScrapeError({ message: `Scrape failed: ${String(e)}`, cause: e }),
  })
}

async function startScrapeImpl(config: ScrapeConfig): Promise<void> {
  const {
    scrapeRunId,
    query,
    maxPlaces = 250,
    scrollSteps = 60,
    headless = false,
    delayMs = 1500,
    reviewLimit = 3,
    profileDir = 'data/profiles/default',
    onProgress,
  } = config

  appRuntime.runSync(
    updateScrapeRun(scrapeRunId, {
      status: 'running',
      startedAt: new Date().toISOString(),
    })
  )

  let context: BrowserContext | undefined
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless,
      viewport: { width: 1440, height: 900 },
    })

    const page = context.pages()[0] ?? (await context.newPage())

    const discoveredUrls = await collectPlaceUrls(page, query, scrollSteps, maxPlaces)

    let placesFound = 0
    let placesUnique = 0

    for (let i = 0; i < discoveredUrls.length; i += 1) {
      const url = discoveredUrls[i]
      const placeId = generatePlaceId(url)

      const existing = appRuntime.runSync(
        getPlace(placeId).pipe(
          Effect.catchTag('NotFoundError', () => Effect.succeed(undefined as undefined))
        )
      )
      if (existing) {
        appRuntime.runSync(linkPlaceToScrapeRun(placeId, scrapeRunId))
        placesFound += 1
        emitProgress(onProgress, {
          placesFound,
          placesUnique,
          currentIndex: i + 1,
          totalUrls: discoveredUrls.length,
          status: 'scraping',
        })
        continue
      }

      const record = await scrapePlace(context, url, reviewLimit)

      const placeInput: CreatePlaceInput = {
        id: placeId,
        googleUrl: url,
        name: record.name ?? 'Unknown',
        category: record.category,
        rating: record.rating,
        reviewCount: record.reviewCount,
        phone: record.phone,
        website: record.website,
        address: record.address,
        lat: record.lat ?? 0,
        lng: record.lng ?? 0,
      }

      appRuntime.runSync(createPlace(placeInput))
      appRuntime.runSync(linkPlaceToScrapeRun(placeId, scrapeRunId))

      for (const review of record.reviews) {
        appRuntime.runSync(createReview(placeId, review.rating, review.text, review.relativeDate ?? undefined))
      }

      placesFound += 1
      placesUnique += 1

      appRuntime.runSync(updateScrapeRun(scrapeRunId, { placesFound, placesUnique }))

      emitProgress(onProgress, {
        placesFound,
        placesUnique,
        currentIndex: i + 1,
        totalUrls: discoveredUrls.length,
        status: 'scraping',
      })

      await sleep(delayMs + randomInt(200, 600))
    }

    appRuntime.runSync(
      updateScrapeRun(scrapeRunId, {
        status: 'completed',
        placesFound,
        placesUnique,
        completedAt: new Date().toISOString(),
      })
    )

    emitProgress(onProgress, {
      placesFound,
      placesUnique,
      currentIndex: discoveredUrls.length,
      totalUrls: discoveredUrls.length,
      status: 'completed',
    })
  } catch (error) {
    appRuntime.runSync(
      updateScrapeRun(scrapeRunId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
      })
    )
    throw error
  } finally {
    if (context) {
      await context.close()
    }
  }
}

function emitProgress(
  onProgress: ((progress: ScrapeProgress) => void) | undefined,
  progress: ScrapeProgress
): void {
  if (onProgress) {
    onProgress(progress)
  }
}

interface ScrapedPlaceData {
  name: string | null
  category: string | null
  rating: number | null
  reviewCount: number | null
  phone: string | null
  website: string | null
  address: string | null
  lat: number | null
  lng: number | null
  reviews: { rating: number; text: string; relativeDate: string | null }[]
}

async function collectPlaceUrls(
  page: Page,
  query: string,
  scrollSteps: number,
  maxPlaces: number
): Promise<string[]> {
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' })
  await tryAcceptConsent(page)
  await waitForUnblock(page)
  await page.waitForTimeout(2500)

  const found = new Set<string>()

  for (let step = 0; step < scrollSteps && found.size < maxPlaces; step += 1) {
    const urls = await page.evaluate(() => {
      const roots = [document.querySelector('div[role="feed"]'), document].filter(Boolean)
      const anchors: HTMLAnchorElement[] = []
      for (const root of roots) {
        anchors.push(
          ...Array.from(
            (root as ParentNode).querySelectorAll('a[href*="/place/"]')
          ) as HTMLAnchorElement[]
        )
        anchors.push(
          ...Array.from(
            (root as ParentNode).querySelectorAll('a[href*="/maps/place/"]')
          ) as HTMLAnchorElement[]
        )
      }
      return anchors.map((a) => a.href)
    })

    for (const raw of urls) {
      const normalized = normalizePlaceUrl(raw)
      if (normalized) {
        found.add(normalized)
      }
      if (found.size >= maxPlaces) {
        break
      }
    }

    await page.evaluate(() => {
      const panel = document.querySelector('div[role="feed"]')
      if (panel) {
        panel.scrollBy(0, 1400)
      } else {
        window.scrollBy(0, 1400)
      }
    })
    await page.waitForTimeout(1000 + randomInt(150, 450))
  }

  return Array.from(found).slice(0, maxPlaces)
}

async function scrapePlace(
  context: BrowserContext,
  url: string,
  reviewLimit: number
): Promise<ScrapedPlaceData> {
  const page = await context.newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await waitForUnblock(page)
    await page.waitForTimeout(1200)

    const data = await page.evaluate((maxReviews) => {
      const text = (selector: string): string | null => {
        const el = document.querySelector(selector)
        return el?.textContent?.trim() || null
      }
      const attr = (selector: string, name: string): string | null => {
        const el = document.querySelector(selector)
        const value = el?.getAttribute(name)
        return value?.trim() || null
      }

      const ratingText = text('div.F7nice span[aria-hidden="true"]')
      const rating = ratingText ? Number(ratingText.replace(',', '.')) : null

      const reviewCountAria =
        attr('button[aria-label*="reviews"]', 'aria-label') ??
        attr('span[aria-label*="reviews"]', 'aria-label')
      const reviewCount = reviewCountAria
        ? Number((reviewCountAria.match(/[\d.,]+/)?.[0] ?? '').replace(/[^\d]/g, ''))
        : null

      const phoneLabel = attr('button[data-item-id^="phone:tel:"]', 'aria-label')
      const phone = phoneLabel ? phoneLabel.replace(/^Phone:\s*/i, '').trim() : null

      const website = attr('a[data-item-id="authority"]', 'href')
      const address = text('button[data-item-id="address"] .Io6YTe')
      const category = text('button[jsaction*="pane.rating.category"]')
      const name = text('h1.DUwDvf') ?? text('h1')

      const reviewEls = Array.from(
        document.querySelectorAll('div.jftiEf span.wiI7pd')
      ) as HTMLElement[]
      const reviews = reviewEls.slice(0, Math.max(0, maxReviews)).map((el) => {
        const container = el.closest('div.jftiEf')
        const starEl = container?.querySelector('span.kvMYJc')
        const starLabel = starEl?.getAttribute('aria-label') ?? ''
        const starMatch = starLabel.match(/(\d)/)
        const reviewRating = starMatch ? Number(starMatch[1]) : 0

        const dateEl = container?.querySelector('span.rsqaWe')
        const relativeDate = dateEl?.textContent?.trim() ?? null

        return {
          rating: reviewRating,
          text: el.innerText.trim(),
          relativeDate,
        }
      })

      return {
        name,
        category,
        rating: Number.isFinite(rating) ? rating : null,
        reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
        phone,
        website,
        address,
        reviews,
      }
    }, reviewLimit)

    const { lat, lng } = parseLatLngFromUrl(page.url())

    return {
      ...data,
      lat,
      lng,
    }
  } finally {
    await page.close()
  }
}

async function waitForUnblock(page: Page): Promise<void> {
  const maxWaitMs = 5 * 60 * 1000 // 5 minutes
  const pollIntervalMs = 3000
  let waited = 0

  while (waited < maxWaitMs) {
    const html = await page.content()
    const blocked = /unusual traffic|verify you are human|captcha/i.test(html)
    if (!blocked) {
      return
    }

    console.log(
      '[scraper] CAPTCHA detected — solve it in the browser window. Polling every 3s...'
    )
    await sleep(pollIntervalMs)
    waited += pollIntervalMs
  }

  throw new Error('CAPTCHA was not resolved within 5 minutes')
}

async function tryAcceptConsent(page: Page): Promise<void> {
  const currentUrl = page.url()
  if (
    !/consent\./i.test(currentUrl) &&
    !/before you continue/i.test(await page.title().catch(() => ''))
  ) {
    return
  }

  const candidates = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Accept")',
    'button[aria-label*="Accept"]',
    'form [type="submit"]',
  ]

  for (const selector of candidates) {
    const button = page.locator(selector).first()
    if (await button.count()) {
      try {
        await button.click({ timeout: 1500 })
        await page.waitForTimeout(1000)
        return
      } catch {
        // Try next selector
      }
    }
  }
}
