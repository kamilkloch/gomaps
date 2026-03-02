import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { getPlaceDetails, textSearch } from '../src/scraper/places-api.js'

describe('places-api', () => {
  const originalApiKey = process.env.GOOGLE_MAPS_API_KEY

  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-api-key'
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = originalApiKey
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('textSearch calls Places Text Search endpoint with field mask and location bias', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          places: [
            {
              id: 'ChIJ_TEXT_SEARCH_1',
              displayName: { text: 'Hotel Naxos' },
              location: { latitude: 37.104, longitude: 25.376 },
              rating: 4.7,
              userRatingCount: 123,
              formattedAddress: 'Naxos, Greece',
              internationalPhoneNumber: '+30 123 456',
              websiteUri: 'https://hotel-naxos.example',
              primaryTypeDisplayName: { text: 'Hotel' },
              priceLevel: 'PRICE_LEVEL_MODERATE',
              googleMapsUri: 'https://maps.google.com/?cid=123',
              googleMapsLinks: { photosUri: 'https://maps.google.com/photos?cid=123' },
              regularOpeningHours: { weekdayDescriptions: ['Monday: Open 24 hours'] },
              photos: [{ name: 'places/ChIJ_TEXT_SEARCH_1/photos/photo-1' }],
              reviews: [
                {
                  rating: 5,
                  text: { text: 'Excellent stay' },
                  relativePublishTimeDescription: '2 weeks ago',
                },
              ],
            },
          ],
          nextPageToken: 'NEXT_PAGE_TOKEN',
        }),
        { status: 200 }
      )
    )

    const result = await Effect.runPromise(
      textSearch({
        query: 'vacation rentals',
        locationBias: {
          center: { lat: 37.1, lng: 25.3 },
          radiusMeters: 2000,
        },
      })
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-api-key')
    expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('places.googleMapsUri')
    expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('places.googleMapsLinks.photosUri')
    expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('places.reviews')

    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.textQuery).toBe('vacation rentals')
    expect(body.locationBias).toEqual({
      circle: {
        center: {
          latitude: 37.1,
          longitude: 25.3,
        },
        radius: 2000,
      },
    })

    expect(result.nextPageToken).toBe('NEXT_PAGE_TOKEN')
    expect(result.places).toHaveLength(1)
    expect(result.places[0].placeId).toBe('ChIJ_TEXT_SEARCH_1')
    expect(result.places[0].place.googleMapsUri).toBe('https://maps.google.com/?cid=123')
    expect(result.places[0].place.googleMapsPhotosUri).toBe('https://maps.google.com/photos?cid=123')
    expect(result.places[0].place.priceLevel).toBe('$$')
    expect(result.places[0].place.websiteType).toBe('direct')
    expect(result.places[0].place.photoUrls).toEqual([
      'https://places.googleapis.com/v1/places/ChIJ_TEXT_SEARCH_1/photos/photo-1/media?maxHeightPx=600&key=test-api-key',
    ])
    expect(result.places[0].reviews).toEqual([
      {
        rating: 5,
        text: 'Excellent stay',
        relativeDate: '2 weeks ago',
      },
    ])
  })

  it('getPlaceDetails calls Places Details endpoint and parses response', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          name: 'places/ChIJ_DETAILS_1',
          displayName: { text: 'Villa Aurora' },
          location: { latitude: 39.21, longitude: 9.11 },
          rating: 4.4,
          userRatingCount: 47,
          formattedAddress: '123 Via Roma, Cagliari',
          websiteUri: 'https://villa-aurora.example',
          primaryTypeDisplayName: { text: 'Vacation rental' },
          googleMapsUri: 'https://maps.google.com/?cid=456',
          googleMapsLinks: { photosUri: 'https://maps.google.com/photos?cid=456' },
          reviews: [
            {
              rating: 4,
              text: { text: 'Great location' },
              relativePublishTimeDescription: '1 month ago',
            },
          ],
        }),
        { status: 200 }
      )
    )

    const result = await Effect.runPromise(getPlaceDetails('ChIJ_DETAILS_1'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://places.googleapis.com/v1/places/ChIJ_DETAILS_1')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-api-key')
    expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('googleMapsUri')
    expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('googleMapsLinks.photosUri')

    expect(result.place.id).toBe('ChIJ_DETAILS_1')
    expect(result.place.googleMapsUri).toBe('https://maps.google.com/?cid=456')
    expect(result.place.googleMapsPhotosUri).toBe('https://maps.google.com/photos?cid=456')
    expect(result.place.name).toBe('Villa Aurora')
    expect(result.place.category).toBe('Vacation rental')
    expect(result.place.lat).toBe(39.21)
    expect(result.place.lng).toBe(9.11)
    expect(result.place.websiteType).toBe('direct')
    expect(result.reviews).toEqual([
      {
        rating: 4,
        text: 'Great location',
        relativeDate: '1 month ago',
      },
    ])
  })
})
