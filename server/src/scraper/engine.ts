import { Effect } from 'effect'
import type { Db } from '../db/Db.js'
import {
  createPlace,
  createReview,
  deleteReviewsByPlace,
  getPlace,
  getScrapeRun,
  linkPlaceToScrapeRun,
  listTiles,
  updatePlace,
  updateScrapeRun,
  updateTile,
  type Tile,
} from '../db/index.js'
import type { DbError, NotFoundError } from '../errors.js'
import { ScrapeError } from '../errors.js'
import { getPlaceDetails, textSearch, type ParsedPlace } from './places-api.js'
import {
  initializeTilesForRun,
  markTileCompleted,
  markTileRunning,
  shouldSubdivide,
  subdivideTileInRun,
  type Bounds,
} from './tiling.js'

export interface StartScrapeConfig {
  scrapeRunId: string
  query: string
  bounds: Bounds
  delayMs?: number
}

type EngineError = DbError | NotFoundError | ScrapeError

const DEFAULT_DELAY_MS = 200
const MAX_TEXT_SEARCH_PAGES = 3

export const startScrape = (config: StartScrapeConfig): Effect.Effect<void, EngineError, Db> => {
  const delayMs = config.delayMs ?? DEFAULT_DELAY_MS

  if (delayMs < 0) {
    return Effect.fail(new ScrapeError({ message: 'delayMs must be >= 0' }))
  }

  const runStartedAt = new Date().toISOString()

  const scrapeEffect = Effect.gen(function* () {
    const run = yield* getScrapeRun(config.scrapeRunId)
    yield* updateScrapeRun(config.scrapeRunId, {
      status: 'running',
      startedAt: run.startedAt ?? runStartedAt,
      completedAt: null,
    })

    const existingTiles = yield* listTiles(config.scrapeRunId)
    if (existingTiles.length === 0) {
      yield* initializeTilesForRun(config.scrapeRunId, config.bounds)
    }

    yield* processTileQueue(config.scrapeRunId, config.query, delayMs)

    yield* updateScrapeRun(config.scrapeRunId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    })
  })

  return scrapeEffect.pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        yield* updateScrapeRun(config.scrapeRunId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
        }).pipe(Effect.catchAll(() => Effect.void))
        return yield* Effect.fail(error)
      })
    )
  )
}

const processTileQueue = (
  scrapeRunId: string,
  query: string,
  delayMs: number
): Effect.Effect<void, EngineError, Db> =>
  Effect.gen(function* () {
    while (true) {
      const tile = yield* nextRunnableTile(scrapeRunId)
      if (!tile) {
        return
      }

      yield* markTileRunning(tile.id)
      const bounds = yield* parseTileBounds(tile)
      const searchResult = yield* searchTilePages(query, bounds, delayMs)

      yield* updateTile(tile.id, { resultCount: searchResult.resultCount })

      if (shouldSubdivide(searchResult.resultCount)) {
        yield* subdivideTileInRun(tile.id)
        continue
      }

      yield* persistTilePlaces(scrapeRunId, searchResult.places, delayMs)
      yield* markTileCompleted(tile.id, searchResult.resultCount)
    }
  })

const nextRunnableTile = (
  scrapeRunId: string
): Effect.Effect<Tile | undefined, DbError, Db> =>
  Effect.map(listTiles(scrapeRunId), (tiles) =>
    [...tiles]
      .filter((tile) => tile.status === 'pending' || tile.status === 'running')
      .sort((a, b) => a.zoomLevel - b.zoomLevel)
      .at(0)
  )

const parseTileBounds = (tile: Tile): Effect.Effect<Bounds, ScrapeError> =>
  Effect.try({
    try: () => {
      const parsed = JSON.parse(tile.bounds) as Bounds
      if (
        parsed.sw.lat >= parsed.ne.lat ||
        parsed.sw.lng >= parsed.ne.lng ||
        Number.isNaN(parsed.sw.lat) ||
        Number.isNaN(parsed.sw.lng) ||
        Number.isNaN(parsed.ne.lat) ||
        Number.isNaN(parsed.ne.lng)
      ) {
        throw new Error('Invalid tile bounds')
      }
      return parsed
    },
    catch: (cause) =>
      new ScrapeError({
        message: `Failed to parse tile bounds for tile ${tile.id}`,
        cause,
      }),
  })

interface TileSearchResult {
  places: ParsedPlace[]
  resultCount: number
}

const searchTilePages = (
  query: string,
  bounds: Bounds,
  delayMs: number
): Effect.Effect<TileSearchResult, ScrapeError> =>
  Effect.gen(function* () {
    const placesById = new Map<string, ParsedPlace>()
    let pageToken: string | undefined
    let resultCount = 0

    for (let pageIndex = 0; pageIndex < MAX_TEXT_SEARCH_PAGES; pageIndex += 1) {
      const response = yield* textSearch({
        query,
        pageToken,
        locationBias: {
          center: getBoundsCenter(bounds),
          radiusMeters: getRadiusMeters(bounds),
        },
      })

      resultCount += response.places.length
      for (const place of response.places) {
        placesById.set(place.placeId, place)
      }

      if (!response.nextPageToken) {
        break
      }

      pageToken = response.nextPageToken
      if (delayMs > 0) {
        yield* sleep(delayMs)
      }
    }

    return {
      places: [...placesById.values()],
      resultCount,
    }
  })

const persistTilePlaces = (
  scrapeRunId: string,
  places: ParsedPlace[],
  delayMs: number
): Effect.Effect<void, EngineError, Db> =>
  Effect.gen(function* () {
    let newPlacesCount = 0

    for (const parsedPlace of places) {
      const existingPlace = yield* getPlace(parsedPlace.placeId).pipe(
        Effect.catchTag('NotFoundError', () => Effect.succeed(undefined as undefined))
      )

      if (existingPlace) {
        yield* linkPlaceToScrapeRun(existingPlace.id, scrapeRunId)
        continue
      }

      yield* createPlace(parsedPlace.place)
      yield* linkPlaceToScrapeRun(parsedPlace.placeId, scrapeRunId)

      if (parsedPlace.reviews.length > 0) {
        yield* Effect.forEach(parsedPlace.reviews, (review) =>
          createReview(parsedPlace.placeId, review.rating, review.text, review.relativeDate ?? undefined)
        )
      }

      const details = yield* getPlaceDetails(parsedPlace.placeId)
      yield* updatePlace(parsedPlace.placeId, details.place)
      yield* deleteReviewsByPlace(parsedPlace.placeId)
      if (details.reviews.length > 0) {
        yield* Effect.forEach(details.reviews, (review) =>
          createReview(parsedPlace.placeId, review.rating, review.text, review.relativeDate ?? undefined)
        )
      }

      if (delayMs > 0) {
        yield* sleep(delayMs)
      }

      newPlacesCount += 1
    }

    if (newPlacesCount > 0) {
      const scrapeRun = yield* getScrapeRun(scrapeRunId)
      yield* updateScrapeRun(scrapeRunId, {
        placesUnique: scrapeRun.placesUnique + newPlacesCount,
      })
    }
  })

const getBoundsCenter = (bounds: Bounds): { lat: number; lng: number } => ({
  lat: (bounds.sw.lat + bounds.ne.lat) / 2,
  lng: (bounds.sw.lng + bounds.ne.lng) / 2,
})

const getRadiusMeters = (bounds: Bounds): number => {
  const center = getBoundsCenter(bounds)
  const latHalfSpanMeters = ((bounds.ne.lat - bounds.sw.lat) / 2) * 111_320
  const lngHalfSpanMeters =
    ((bounds.ne.lng - bounds.sw.lng) / 2) * 111_320 * Math.cos((center.lat * Math.PI) / 180)

  const radius = Math.sqrt(latHalfSpanMeters ** 2 + lngHalfSpanMeters ** 2)
  return Math.max(Math.ceil(radius), 50)
}

const sleep = (delayMs: number): Effect.Effect<void, ScrapeError> =>
  Effect.tryPromise({
    try: () => new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
    catch: (cause) =>
      new ScrapeError({
        message: `Failed during scrape delay of ${delayMs}ms`,
        cause,
      }),
  })
