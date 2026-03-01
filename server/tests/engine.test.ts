import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, ManagedRuntime } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DbLive } from '../src/db/Db.js'
import {
  createPlace,
  createProject,
  createScrapeRun,
  getScrapeRun,
  listPlaceScrapeRuns,
  listPlaces,
} from '../src/db/index.js'
import { listTiles, updateTile } from '../src/db/tiles.js'
import { listReviews } from '../src/db/reviews.js'
import { initializeTilesForRun } from '../src/scraper/tiling.js'

const { textSearchMock, getPlaceDetailsMock } = vi.hoisted(() => ({
  textSearchMock: vi.fn(),
  getPlaceDetailsMock: vi.fn(),
}))

vi.mock('../src/scraper/places-api.js', () => ({
  textSearch: textSearchMock,
  getPlaceDetails: getPlaceDetailsMock,
}))

import { startScrape } from '../src/scraper/engine.js'

describe('scraper engine', () => {
  let dbPath = ''
  let runtime: ManagedRuntime.ManagedRuntime<import('../src/db/Db.js').Db, never>

  beforeEach(() => {
    dbPath = join(tmpdir(), `gomaps-engine-${randomUUID()}.db`)
    runtime = ManagedRuntime.make(DbLive(dbPath))
    textSearchMock.mockReset()
    getPlaceDetailsMock.mockReset()
  })

  afterEach(async () => {
    await runtime.dispose()
    try {
      unlinkSync(dbPath)
    } catch {
      // ignore cleanup errors
    }
  })

  it('orchestrates pagination, subdivision, dedup, and progress updates', async () => {
    textSearchMock
      .mockReturnValueOnce(
        Effect.succeed({
          places: Array.from({ length: 60 }, (_value, index) => parsedPlace(`overflow-${index}`)),
          nextPageToken: null,
        })
      )
      .mockReturnValueOnce(
        Effect.succeed({
          places: [parsedPlace('A'), parsedPlace('B')],
          nextPageToken: 'page-2',
        })
      )
      .mockReturnValueOnce(
        Effect.succeed({
          places: [parsedPlace('B'), parsedPlace('C')],
          nextPageToken: null,
        })
      )
      .mockReturnValueOnce(
        Effect.succeed({
          places: [parsedPlace('C'), parsedPlace('D')],
          nextPageToken: null,
        })
      )
      .mockReturnValueOnce(Effect.succeed({ places: [], nextPageToken: null }))
      .mockReturnValueOnce(
        Effect.succeed({
          places: [parsedPlace('E')],
          nextPageToken: null,
        })
      )

    getPlaceDetailsMock.mockImplementation((placeId: string) =>
      Effect.succeed({
        place: parsedPlace(placeId).place,
        reviews: [{ rating: 5, text: `detail-${placeId}`, relativeDate: 'today' }],
      })
    )

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const project = yield* createProject('Sardinia', null)
        const run = yield* createScrapeRun(project.id, 'vacation rentals')

        yield* startScrape({
          scrapeRunId: run.id,
          query: run.query,
          bounds: {
            sw: { lat: 39.0, lng: 8.0 },
            ne: { lat: 39.1, lng: 8.1 },
          },
          delayMs: 0,
        })

        const updatedRun = yield* getScrapeRun(run.id)
        const tiles = yield* listTiles(run.id)
        const places = yield* listPlaces(project.id)
        const links = yield* listPlaceScrapeRuns(run.id)
        const reviews = yield* Effect.forEach(places, (place) => listReviews(place.id))

        return {
          updatedRun,
          tiles,
          placeCount: places.length,
          linkCount: links.length,
          reviewCounts: reviews.map((entry) => entry.length),
        }
      })
    )

    expect(textSearchMock).toHaveBeenCalledTimes(6)
    expect(getPlaceDetailsMock).toHaveBeenCalledTimes(5)

    expect(result.updatedRun.status).toBe('completed')
    expect(result.updatedRun.tilesTotal).toBe(5)
    expect(result.updatedRun.tilesCompleted).toBe(4)
    expect(result.updatedRun.tilesSubdivided).toBe(1)
    expect(result.updatedRun.placesFound).toBe(7)
    expect(result.updatedRun.placesUnique).toBe(5)

    expect(result.tiles.filter((tile) => tile.status === 'subdivided')).toHaveLength(1)
    expect(result.tiles.filter((tile) => tile.status === 'completed')).toHaveLength(4)
    expect(result.placeCount).toBe(5)
    expect(result.linkCount).toBe(5)
    expect(result.reviewCounts.every((count) => count === 1)).toBe(true)
  })

  it('resumes from existing tiles and skips details for existing places', async () => {
    textSearchMock.mockReturnValue(
      Effect.succeed({
        places: [parsedPlace('existing'), parsedPlace('new-one')],
        nextPageToken: null,
      })
    )
    getPlaceDetailsMock.mockImplementation((placeId: string) =>
      Effect.succeed({
        place: parsedPlace(placeId).place,
        reviews: [],
      })
    )

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const project = yield* createProject('Resume run', null)
        const run = yield* createScrapeRun(project.id, 'boutique hotels')

        yield* createPlace(parsedPlace('existing').place)
        const initializedTiles = yield* initializeTilesForRun(run.id, {
          sw: { lat: 41.0, lng: 9.0 },
          ne: { lat: 41.05, lng: 9.05 },
        })
        yield* updateTile(initializedTiles[0].id, { status: 'running' })

        yield* startScrape({
          scrapeRunId: run.id,
          query: run.query,
          bounds: {
            sw: { lat: 41.0, lng: 9.0 },
            ne: { lat: 41.05, lng: 9.05 },
          },
          delayMs: 0,
        })

        const updatedRun = yield* getScrapeRun(run.id)
        const links = yield* listPlaceScrapeRuns(run.id)
        const tiles = yield* listTiles(run.id)
        return {
          updatedRun,
          linkCount: links.length,
          tileCount: tiles.length,
        }
      })
    )

    expect(textSearchMock).toHaveBeenCalledTimes(1)
    expect(getPlaceDetailsMock).toHaveBeenCalledTimes(1)
    expect(result.updatedRun.tilesTotal).toBe(1)
    expect(result.updatedRun.tilesCompleted).toBe(1)
    expect(result.updatedRun.placesUnique).toBe(1)
    expect(result.linkCount).toBe(2)
    expect(result.tileCount).toBe(1)
  })

  it('persists places when overflowing tiles cannot subdivide further', async () => {
    const denseTilePlaces = Array.from({ length: 60 }, (_value, index) =>
      parsedPlace(`dense-${index}`)
    )

    textSearchMock.mockReturnValue(
      Effect.succeed({
        places: denseTilePlaces,
        nextPageToken: null,
      })
    )
    getPlaceDetailsMock.mockImplementation((placeId: string) =>
      Effect.succeed({
        place: parsedPlace(placeId).place,
        reviews: [],
      })
    )

    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const project = yield* createProject('Dense leaf tile', null)
        const run = yield* createScrapeRun(project.id, 'hotel')

        yield* startScrape({
          scrapeRunId: run.id,
          query: run.query,
          bounds: {
            sw: { lat: 40.0, lng: 8.0 },
            ne: { lat: 40.01, lng: 8.01 },
          },
          delayMs: 0,
        })

        const updatedRun = yield* getScrapeRun(run.id)
        const places = yield* listPlaces(project.id)
        const links = yield* listPlaceScrapeRuns(run.id)

        return {
          updatedRun,
          placeCount: places.length,
          linkCount: links.length,
        }
      })
    )

    expect(textSearchMock).toHaveBeenCalledTimes(1)
    expect(getPlaceDetailsMock).toHaveBeenCalledTimes(60)
    expect(result.updatedRun.status).toBe('completed')
    expect(result.updatedRun.tilesTotal).toBe(1)
    expect(result.updatedRun.tilesCompleted).toBe(1)
    expect(result.updatedRun.tilesSubdivided).toBe(0)
    expect(result.updatedRun.placesFound).toBe(60)
    expect(result.updatedRun.placesUnique).toBe(60)
    expect(result.placeCount).toBe(60)
    expect(result.linkCount).toBe(60)
  })
})

const parsedPlace = (id: string) => ({
  placeId: id,
  place: {
    id,
    googleMapsUri: `https://maps.google.com/?cid=${id}`,
    name: `Place ${id}`,
    category: 'hotel',
    rating: 4.2,
    reviewCount: 100,
    priceLevel: '$$',
    phone: null,
    website: `https://${id}.example.com`,
    websiteType: 'unknown' as const,
    address: `${id} Street`,
    lat: 40.0,
    lng: 8.0,
    photoUrls: [],
    openingHours: null,
    amenities: [],
  },
  reviews: [{ rating: 4, text: `summary-${id}`, relativeDate: '1 day ago' }],
})
