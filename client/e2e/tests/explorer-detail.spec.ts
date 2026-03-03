import { expect, test } from '../fixtures/base'
import { createExplorerPage } from '../pages/explorer-page'
import { captureStepScreenshot } from '../utils/screenshots'
import { seedFixtures } from '../utils/test-backdoor'
import { expectGoogleMapHasContent, expectGoogleMapRendered } from '../utils/waiters'

const mapsKeyForE2E = (process.env.VITE_GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? '').trim()
const shouldRequireInteractiveMaps = mapsKeyForE2E.length > 0
  && mapsKeyForE2E !== 'your_google_maps_api_key_here'
  && mapsKeyForE2E !== 'your_key_here'

test.describe('explorer detail panel and formatting story-boards', () => {
  test('detail panel renders full seeded content', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Explorer Detail Full Content',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.5, lng: 9.5 } }),
      },
      places: [
        {
          id: 'detail-rich-place',
          googleMapsUri: 'https://maps.google.com/?cid=detail-rich-place',
          googleMapsPhotosUri: 'https://maps.google.com/?cid=detail-rich-place&view=photos',
          name: 'Villa Sunset Retreat',
          category: 'Vacation rental',
          rating: 4.8,
          reviewCount: 310,
          priceLevel: '$$$',
          phone: '+39070111222',
          website: 'https://sunset-retreat.example',
          websiteType: 'direct',
          address: 'Via del Mare 12, Cagliari',
          lat: 40.12,
          lng: 9.11,
          photoUrls: ['https://example.com/photo-a.jpg', 'https://example.com/photo-b.jpg'],
          openingHours: 'Mon-Sun 08:00-22:00',
          amenities: ['Pool', 'WiFi', 'Parking'],
        },
      ],
    })

    const explorerPage = createExplorerPage(page)
    await explorerPage.goto(seeded.projectId)
    await captureStepScreenshot(page, testInfo, 'explorer-detail-full-before-selection')

    await explorerPage.clickRow('detail-rich-place')
    const encodedSearchLabel = encodeURIComponent('Villa Sunset Retreat, Via del Mare 12, Cagliari')
    await expect(page.getByTestId('explorer-detail-name')).toHaveText('Villa Sunset Retreat')
    await expect(page.getByTestId('explorer-detail-category')).toContainText('Vacation rental')
    await expect(page.getByTestId('explorer-detail-rating')).toContainText('4.8')
    await expect(page.getByTestId('explorer-detail-rating')).toContainText('310 reviews')
    await expect(page.getByTestId('explorer-detail-address')).toContainText('Via del Mare 12, Cagliari')
    await expect(page.getByTestId('explorer-detail-phone').getByRole('link')).toHaveAttribute('href', 'tel:+39070111222')
    await expect(page.getByTestId('explorer-detail-website').getByRole('link')).toHaveAttribute('href', 'https://sunset-retreat.example')
    await expect(page.getByTestId('explorer-detail-website-badge')).toHaveClass(/explorer-website-direct/)
    await expect(page.getByTestId('explorer-detail-price')).toContainText('$$$')
    await expect(page.getByTestId('explorer-detail-amenities')).toContainText('Pool')
    await expect(page.getByTestId('explorer-detail-amenities')).toContainText('WiFi')
    await expect(page.getByTestId('explorer-detail-amenities')).toContainText('Parking')
    await expect(page.getByTestId('explorer-detail-photos').getByTestId('explorer-detail-photo-0')).toHaveAttribute(
      'href',
      'https://example.com/photo-a.jpg',
    )
    await expect(page.getByTestId('explorer-detail-photos').getByTestId('explorer-detail-photo-1')).toHaveAttribute(
      'href',
      'https://example.com/photo-b.jpg',
    )
    await expect(page.getByTestId('explorer-detail-action-open-google-maps')).toHaveAttribute(
      'href',
      'https://maps.google.com/?cid=detail-rich-place',
    )
    await expect(page.getByTestId('explorer-detail-action-open-google-maps')).toHaveAttribute('target', '_blank')
    await expect(page.getByTestId('explorer-detail-action-open-google-maps').locator('svg')).toHaveCount(1)
    await expect(page.getByTestId('explorer-detail-action-view-photos-google-maps')).toHaveAttribute(
      'href',
      'https://maps.google.com/?cid=detail-rich-place&view=photos',
    )
    await expect(page.getByTestId('explorer-detail-action-view-photos-google-maps')).toHaveAttribute('target', '_blank')
    await expect(page.getByTestId('explorer-detail-action-view-photos-google-maps').locator('svg')).toHaveCount(1)
    await expect(page.getByTestId('explorer-detail-action-search-booking')).toHaveAttribute(
      'href',
      `https://www.booking.com/searchresults.html?ss=${encodedSearchLabel}`,
    )
    await expect(page.getByTestId('explorer-detail-action-search-booking')).toHaveAttribute('target', '_blank')
    await expect(page.getByTestId('explorer-detail-action-search-booking').locator('svg')).toHaveCount(1)
    await expect(page.getByTestId('explorer-detail-action-search-airbnb')).toHaveAttribute(
      'href',
      `https://www.airbnb.com/s/${encodedSearchLabel}/homes`,
    )
    await expect(page.getByTestId('explorer-detail-action-search-airbnb')).toHaveAttribute('target', '_blank')
    await expect(page.getByTestId('explorer-detail-action-search-airbnb').locator('svg')).toHaveCount(1)
    await expect(page.getByTestId('explorer-detail-opening-hours')).toContainText('Mon-Sun 08:00-22:00')
    await expect(page.getByTestId('explorer-detail-scraped-at')).toContainText('Scraped at:')
    await captureStepScreenshot(page, testInfo, 'explorer-detail-full-after-selection')
  })

  test('external search actions stay hidden when selected place has no search context', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Explorer Missing Search Context',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.5, lng: 9.5 } }),
      },
      places: [
        {
          id: 'place-no-name',
          googleMapsUri: 'https://maps.google.com/?cid=place-no-name',
          name: '   ',
          lat: 40.22,
          lng: 9.22,
        },
      ],
    })

    const explorerPage = createExplorerPage(page)
    await explorerPage.goto(seeded.projectId)
    await explorerPage.clickRow('place-no-name')

    await expect(page.getByTestId('explorer-detail-action-open-google-maps')).toHaveCount(0)
    await expect(page.getByTestId('explorer-detail-action-view-photos-google-maps')).toHaveCount(0)
    await expect(page.getByTestId('explorer-detail-action-search-booking')).toHaveCount(0)
    await expect(page.getByTestId('explorer-detail-action-search-airbnb')).toHaveCount(0)
    await captureStepScreenshot(page, testInfo, 'explorer-detail-missing-search-context')
  })

  test('website badge classes and price formatting render for all expected variants', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Explorer Website and Price Formatting',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.5, lng: 9.5 } }),
      },
      places: [
        {
          id: 'place-direct',
          googleMapsUri: 'https://maps.google.com/?cid=place-direct',
          name: 'Direct Stay',
          rating: 4.7,
          websiteType: 'direct',
          priceLevel: '$',
          lat: 40.11,
          lng: 9.11,
        },
        {
          id: 'place-ota',
          googleMapsUri: 'https://maps.google.com/?cid=place-ota',
          name: 'OTA Stay',
          rating: 4.5,
          websiteType: 'ota',
          priceLevel: '$$',
          lat: 40.12,
          lng: 9.12,
        },
        {
          id: 'place-social',
          googleMapsUri: 'https://maps.google.com/?cid=place-social',
          name: 'Social Stay',
          rating: 4.3,
          websiteType: 'social',
          priceLevel: '$$$',
          lat: 40.13,
          lng: 9.13,
        },
        {
          id: 'place-price-enum',
          googleMapsUri: 'https://maps.google.com/?cid=place-price-enum',
          name: 'Enum Price Stay',
          rating: 4.1,
          websiteType: 'unknown',
          priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
          lat: 40.14,
          lng: 9.14,
        },
        {
          id: 'place-price-empty',
          googleMapsUri: 'https://maps.google.com/?cid=place-price-empty',
          name: 'No Price Stay',
          rating: 3.9,
          websiteType: 'unknown',
          lat: 40.15,
          lng: 9.15,
        },
      ],
    })

    const explorerPage = createExplorerPage(page)
    await explorerPage.goto(seeded.projectId)

    await expect(page.getByTestId('explorer-website-badge-place-direct')).toHaveClass(/explorer-website-direct/)
    await expect(page.getByTestId('explorer-website-badge-place-ota')).toHaveClass(/explorer-website-ota/)
    await expect(page.getByTestId('explorer-website-badge-place-social')).toHaveClass(/explorer-website-social/)

    await expect(page.getByTestId('explorer-price-place-direct')).toHaveText('$')
    await expect(page.getByTestId('explorer-price-place-ota')).toHaveText('$$')
    await expect(page.getByTestId('explorer-price-place-social')).toHaveText('$$$')
    await expect(page.getByTestId('explorer-price-place-price-enum')).toHaveText('Inexpensive')
    await expect(page.getByTestId('explorer-price-place-price-empty')).toHaveText('—')
    await captureStepScreenshot(page, testInfo, 'explorer-website-price-variants')
  })

  test('marker colors are derived from place ratings in interactive map mode', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Explorer Marker Color Ratings',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.5, lng: 9.5 } }),
      },
      places: [
        {
          id: 'marker-low',
          googleMapsUri: 'https://maps.google.com/?cid=marker-low',
          name: 'Low Rating Inn',
          rating: 3.2,
          lat: 40.1,
          lng: 9.1,
        },
        {
          id: 'marker-mid',
          googleMapsUri: 'https://maps.google.com/?cid=marker-mid',
          name: 'Mid Rating Inn',
          rating: 3.9,
          lat: 40.2,
          lng: 9.2,
        },
        {
          id: 'marker-high',
          googleMapsUri: 'https://maps.google.com/?cid=marker-high',
          name: 'High Rating Inn',
          rating: 4.6,
          lat: 40.3,
          lng: 9.3,
        },
      ],
    })

    const explorerPage = createExplorerPage(page)
    await explorerPage.goto(seeded.projectId)

    const mapMode = await expectGoogleMapRendered(page, 'explorer-map-panel', 'explorer-map-fallback')
    if (shouldRequireInteractiveMaps) {
      expect(mapMode).toBe('interactive')
    }
    test.skip(mapMode !== 'interactive', 'Interactive map unavailable; skipping marker-color assertions.')

    await expectGoogleMapHasContent(page, 'explorer-map-panel')
    await expect(page.getByTestId('explorer-marker-debug')).toContainText('marker-high')

    const markerDebug = await page.getByTestId('explorer-marker-debug').textContent()
    const parsed = JSON.parse(markerDebug ?? '[]') as MarkerDebugEntry[]
    const fillColorById = new Map(parsed.map((entry) => [entry.placeId, entry.fillColor]))

    expect(fillColorById.get('marker-low')).toBe('#e35d63')
    expect(fillColorById.get('marker-mid')).toBe('#f0ca53')
    expect(fillColorById.get('marker-high')).toBe('#5dd58b')
    await captureStepScreenshot(page, testInfo, 'explorer-marker-colors')
  })

  test('empty project explorer renders zero-count state without rows', async ({ page, request }, testInfo) => {
    const seeded = await seedFixtures(request, {
      project: {
        name: 'Explorer Empty Project',
        bounds: JSON.stringify({ sw: { lat: 40.0, lng: 9.0 }, ne: { lat: 40.5, lng: 9.5 } }),
      },
    })

    const explorerPage = createExplorerPage(page)
    await explorerPage.goto(seeded.projectId)

    await expect(await explorerPage.root()).toBeVisible()
    await expect(page.getByTestId('explorer-table-count')).toContainText('0 places')
    await expect(page.locator('[data-testid^="explorer-row-"]')).toHaveCount(0)
    await expect(page.getByTestId('explorer-detail-panel')).toContainText('Select a marker to inspect place details.')
    await captureStepScreenshot(page, testInfo, 'explorer-empty-project')
  })

  test('bare explorer route without projects stays stable with empty selector', async ({ page }, testInfo) => {
    await page.goto('/explorer')

    await expect(page.getByTestId('explorer-page')).toBeVisible()
    await expect(page.getByTestId('explorer-project-select')).toBeDisabled()
    await expect(page.getByTestId('explorer-project-select')).toContainText('No projects')
    await expect(page.getByTestId('explorer-table-count')).toContainText('0 places')
    await captureStepScreenshot(page, testInfo, 'explorer-no-projects')
  })
})

interface MarkerDebugEntry {
  placeId: string
  fillColor: string
}
