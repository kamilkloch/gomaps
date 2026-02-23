import { describe, it, expect } from 'vitest'
import {
  normalizePlaceUrl,
  parseLatLngFromUrl,
  generatePlaceId,
} from '../src/scraper/utils.js'

describe('normalizePlaceUrl', () => {
  it('extracts origin + pathname from a valid place URL', () => {
    const raw =
      'https://www.google.com/maps/place/Hotel+Sardinia/@39.21,9.12,15z/data=!3m1!4b1'
    expect(normalizePlaceUrl(raw)).toBe(
      'https://www.google.com/maps/place/Hotel+Sardinia/@39.21,9.12,15z/data=!3m1!4b1'
    )
  })

  it('strips query parameters', () => {
    const raw =
      'https://www.google.com/maps/place/Hotel+Test/@40.0,9.0,15z?utm_source=maps'
    expect(normalizePlaceUrl(raw)).toBe(
      'https://www.google.com/maps/place/Hotel+Test/@40.0,9.0,15z'
    )
  })

  it('returns null for URLs without /place/', () => {
    expect(normalizePlaceUrl('https://www.google.com/maps/search/hotels')).toBeNull()
  })

  it('returns null for completely invalid URLs', () => {
    expect(normalizePlaceUrl('not-a-url')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(normalizePlaceUrl('')).toBeNull()
  })

  it('handles /maps/place/ path variant', () => {
    const raw = 'https://www.google.com/maps/place/SomeHotel'
    expect(normalizePlaceUrl(raw)).toBe('https://www.google.com/maps/place/SomeHotel')
  })

  it('preserves origin for different Google domains', () => {
    const raw = 'https://maps.google.it/maps/place/Hotel+Roma/@41.89,12.49,15z'
    expect(normalizePlaceUrl(raw)).toBe(
      'https://maps.google.it/maps/place/Hotel+Roma/@41.89,12.49,15z'
    )
  })

  it('strips fragment identifiers', () => {
    const raw = 'https://www.google.com/maps/place/Hotel+Test/@40.0,9.0,15z#section'
    expect(normalizePlaceUrl(raw)).toBe(
      'https://www.google.com/maps/place/Hotel+Test/@40.0,9.0,15z'
    )
  })
})

describe('parseLatLngFromUrl', () => {
  it('extracts lat/lng from a standard Google Maps URL', () => {
    const url =
      'https://www.google.com/maps/place/Hotel+Test/@39.2150,9.1234,15z/data=!3m1!4b1'
    expect(parseLatLngFromUrl(url)).toEqual({ lat: 39.215, lng: 9.1234 })
  })

  it('handles negative coordinates', () => {
    const url = 'https://www.google.com/maps/place/Place/@-33.8688,151.2093,15z'
    expect(parseLatLngFromUrl(url)).toEqual({ lat: -33.8688, lng: 151.2093 })
  })

  it('handles both negative lat and lng', () => {
    const url = 'https://www.google.com/maps/place/Place/@-22.9068,-43.1729,15z'
    expect(parseLatLngFromUrl(url)).toEqual({ lat: -22.9068, lng: -43.1729 })
  })

  it('returns nulls when no coordinates are present', () => {
    const url = 'https://www.google.com/maps/place/SomePlace'
    expect(parseLatLngFromUrl(url)).toEqual({ lat: null, lng: null })
  })

  it('returns nulls for empty string', () => {
    expect(parseLatLngFromUrl('')).toEqual({ lat: null, lng: null })
  })

  it('handles coordinates with many decimal places', () => {
    const url = 'https://www.google.com/maps/place/Hotel/@39.12345678,9.87654321,17z'
    expect(parseLatLngFromUrl(url)).toEqual({ lat: 39.12345678, lng: 9.87654321 })
  })
})

describe('generatePlaceId', () => {
  it('returns a 16-character hex string', () => {
    const id = generatePlaceId('https://www.google.com/maps/place/Hotel+Test')
    expect(id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('returns same ID for same URL', () => {
    const url = 'https://www.google.com/maps/place/Hotel+Test'
    expect(generatePlaceId(url)).toBe(generatePlaceId(url))
  })

  it('returns different IDs for different URLs', () => {
    const id1 = generatePlaceId('https://www.google.com/maps/place/Hotel+A')
    const id2 = generatePlaceId('https://www.google.com/maps/place/Hotel+B')
    expect(id1).not.toBe(id2)
  })
})
