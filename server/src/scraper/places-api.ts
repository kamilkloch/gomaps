import { Effect } from 'effect'
import type { CreatePlaceInput } from '../db/places.js'
import { ScrapeError } from '../errors.js'
import { classifyWebsite } from './classifier.js'

const TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const PLACE_DETAILS_URL_BASE = 'https://places.googleapis.com/v1/places'

const TEXT_SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.formattedAddress',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.primaryTypeDisplayName',
  'places.priceLevel',
  'places.googleMapsUri',
  'places.reviews',
  'places.photos',
  'places.regularOpeningHours',
  'nextPageToken',
].join(',')

const PLACE_DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'location',
  'rating',
  'userRatingCount',
  'formattedAddress',
  'internationalPhoneNumber',
  'websiteUri',
  'primaryTypeDisplayName',
  'priceLevel',
  'googleMapsUri',
  'reviews',
  'photos',
  'regularOpeningHours',
].join(',')

interface PlacesApiReview {
  rating: number
  text: string
  relativeDate: string | null
}

export interface ParsedPlace {
  placeId: string
  place: CreatePlaceInput
  reviews: PlacesApiReview[]
}

export interface TextSearchInput {
  query: string
  locationBias?: {
    center: {
      lat: number
      lng: number
    }
    radiusMeters: number
  }
  pageToken?: string
}

export interface TextSearchResult {
  places: ParsedPlace[]
  nextPageToken: string | null
}

export interface PlaceDetailsResult {
  place: CreatePlaceInput
  reviews: PlacesApiReview[]
}

export const textSearch = (input: TextSearchInput): Effect.Effect<TextSearchResult, ScrapeError> =>
  Effect.gen(function* () {
    const apiKey = getApiKey()
    const payload: Record<string, unknown> = {
      textQuery: input.query,
    }

    if (input.locationBias) {
      payload.locationBias = {
        circle: {
          center: {
            latitude: input.locationBias.center.lat,
            longitude: input.locationBias.center.lng,
          },
          radius: input.locationBias.radiusMeters,
        },
      }
    }

    if (input.pageToken) {
      payload.pageToken = input.pageToken
    }

    const response = yield* fetchJson<PlacesTextSearchResponse>(TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': TEXT_SEARCH_FIELD_MASK,
      },
      body: JSON.stringify(payload),
    })

    const places = response.places?.map((place) => parsePlace(place, apiKey)) ?? []
    return {
      places,
      nextPageToken: response.nextPageToken ?? null,
    }
  })

export const getPlaceDetails = (placeId: string): Effect.Effect<PlaceDetailsResult, ScrapeError> =>
  Effect.gen(function* () {
    const apiKey = getApiKey()
    const url = `${PLACE_DETAILS_URL_BASE}/${encodeURIComponent(placeId)}`
    const response = yield* fetchJson<PlacesDetailsResponse>(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACE_DETAILS_FIELD_MASK,
      },
    })

    const parsed = parsePlace(response, apiKey)
    return {
      place: parsed.place,
      reviews: parsed.reviews,
    }
  })

const fetchJson = <T>(url: string, init: RequestInit): Effect.Effect<T, ScrapeError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, init)
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Places API request failed (${response.status}): ${body}`)
      }
      return (await response.json()) as T
    },
    catch: (error) =>
      new ScrapeError({
        message: `Places API request failed: ${String(error)}`,
        cause: error,
      }),
  })

const getApiKey = (): string => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    throw new ScrapeError({ message: 'GOOGLE_MAPS_API_KEY is not set' })
  }
  return apiKey
}

const parsePlace = (place: PlaceResult, apiKey: string): ParsedPlace => {
  const placeId = extractPlaceId(place)
  if (!place.location) {
    throw new ScrapeError({ message: `Missing location for place: ${placeId}` })
  }

  return {
    placeId,
    place: {
      id: placeId,
      googleMapsUri: place.googleMapsUri ?? '',
      name: place.displayName?.text ?? 'Unknown',
      category: place.primaryTypeDisplayName?.text ?? null,
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount ?? null,
      priceLevel: mapPriceLevel(place.priceLevel),
      phone: place.internationalPhoneNumber ?? null,
      website: place.websiteUri ?? null,
      websiteType: classifyWebsite(place.websiteUri),
      address: place.formattedAddress ?? null,
      lat: place.location.latitude,
      lng: place.location.longitude,
      photoUrls: mapPhotoUrls(place.photos, apiKey),
      openingHours: mapOpeningHours(place.regularOpeningHours),
      amenities: [],
    },
    reviews: mapReviews(place.reviews),
  }
}

const extractPlaceId = (place: PlaceResult): string => {
  if (place.id) {
    return place.id
  }
  if (place.name?.startsWith('places/')) {
    return place.name.replace('places/', '')
  }
  throw new ScrapeError({ message: 'Missing place ID in Places API response' })
}

const mapPriceLevel = (priceLevel?: string): string | null => {
  switch (priceLevel) {
    case 'PRICE_LEVEL_FREE':
      return '$'
    case 'PRICE_LEVEL_INEXPENSIVE':
      return '$'
    case 'PRICE_LEVEL_MODERATE':
      return '$$'
    case 'PRICE_LEVEL_EXPENSIVE':
      return '$$$'
    case 'PRICE_LEVEL_VERY_EXPENSIVE':
      return '$$$$'
    default:
      return null
  }
}

const mapOpeningHours = (
  openingHours?: { weekdayDescriptions?: string[] }
): string | null => openingHours?.weekdayDescriptions?.join('\n') ?? null

const mapPhotoUrls = (photos: { name?: string }[] | undefined, apiKey: string): string[] =>
  photos
    ?.map((photo) => {
      if (!photo.name) {
        return null
      }
      return `https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=600&key=${encodeURIComponent(apiKey)}`
    })
    .filter((photoUrl): photoUrl is string => Boolean(photoUrl)) ?? []

const mapReviews = (reviews: PlaceReview[] | undefined): PlacesApiReview[] =>
  reviews
    ?.map((review) => ({
      rating: review.rating ?? 0,
      text: review.text?.text ?? '',
      relativeDate: review.relativePublishTimeDescription ?? null,
    }))
    .filter((review) => review.text.length > 0) ?? []

interface PlacesTextSearchResponse {
  places?: PlaceResult[]
  nextPageToken?: string
}

interface PlacesDetailsResponse extends PlaceResult {}

interface PlaceResult {
  id?: string
  name?: string
  displayName?: {
    text?: string
  }
  location?: {
    latitude: number
    longitude: number
  }
  rating?: number
  userRatingCount?: number
  formattedAddress?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  primaryTypeDisplayName?: {
    text?: string
  }
  priceLevel?: string
  googleMapsUri?: string
  reviews?: PlaceReview[]
  photos?: {
    name?: string
  }[]
  regularOpeningHours?: {
    weekdayDescriptions?: string[]
  }
}

interface PlaceReview {
  rating?: number
  text?: {
    text?: string
  }
  relativePublishTimeDescription?: string
}
