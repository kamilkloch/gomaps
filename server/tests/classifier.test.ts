import { describe, expect, it } from 'vitest'
import { classifyWebsite } from '../src/scraper/classifier.js'

describe('classifyWebsite', () => {
  it('returns unknown for empty values', () => {
    expect(classifyWebsite(undefined)).toBe('unknown')
    expect(classifyWebsite(null)).toBe('unknown')
    expect(classifyWebsite('')).toBe('unknown')
    expect(classifyWebsite('   ')).toBe('unknown')
  })

  it('classifies known OTA domains', () => {
    expect(classifyWebsite('https://booking.com/hotel/abc')).toBe('ota')
    expect(classifyWebsite('https://www.airbnb.com/rooms/123')).toBe('ota')
    expect(classifyWebsite('https://expedia.com/Hotel-Search')).toBe('ota')
    expect(classifyWebsite('https://hotels.com/hotel/details')).toBe('ota')
    expect(classifyWebsite('https://vrbo.com/987654')).toBe('ota')
    expect(classifyWebsite('https://agoda.com/some-listing')).toBe('ota')
    expect(classifyWebsite('https://tripadvisor.com/Hotel_Review')).toBe('ota')
  })

  it('classifies known social domains', () => {
    expect(classifyWebsite('https://facebook.com/my-hotel')).toBe('social')
    expect(classifyWebsite('https://www.instagram.com/villa.aurora')).toBe('social')
  })

  it('classifies direct websites for non-allowlisted hosts', () => {
    expect(classifyWebsite('https://www.hotel-example.it')).toBe('direct')
    expect(classifyWebsite('villa-aurora.com')).toBe('direct')
    expect(classifyWebsite('http://book.hotel-example.it/booking')).toBe('direct')
  })

  it('matches allowlisted domains on subdomains and case-insensitive hosts', () => {
    expect(classifyWebsite('https://WWW.BOOKING.COM/Hotel')).toBe('ota')
    expect(classifyWebsite('https://m.facebook.com/page')).toBe('social')
    expect(classifyWebsite('https://stay.booking.co.uk/property')).toBe('ota')
  })

  it('returns unknown when URL parsing fails', () => {
    expect(classifyWebsite('http://')).toBe('unknown')
    expect(classifyWebsite('https://?bad-url')).toBe('unknown')
  })
})
