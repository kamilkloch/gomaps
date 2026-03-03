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
  shouldPause?: () => boolean
  onProgress?: (progress: ScrapeProgress) => void
}

export interface ScrapeProgress {
  scrapeRunId: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  tilesTotal: number
  tilesCompleted: number
  tilesSubdivided: number
  placesFound: number
  placesUnique: number
  elapsedMs: number
}

type EngineError = DbError | NotFoundError | ScrapeError
type RunOutcome = 'completed' | 'paused'

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
    const startedAt = run.startedAt ?? runStartedAt

    yield* updateScrapeRun(config.scrapeRunId, {
      status: 'running',
      startedAt,
      completedAt: null,
    })
    yield* notifyProgress(config.scrapeRunId, startedAt, config.onProgress)

    const existingTiles = yield* listTiles(config.scrapeRunId)
    if (existingTiles.length === 0) {
      yield* initializeTilesForRun(config.scrapeRunId, config.bounds)
      yield* notifyProgress(config.scrapeRunId, startedAt, config.onProgress)
    }

    const runOutcome = yield* processTileQueue(
      config.scrapeRunId,
      config.query,
      delayMs,
      startedAt,
      config.shouldPause,
      config.onProgress
    )

    if (runOutcome === 'paused') {
      yield* updateScrapeRun(config.scrapeRunId, {
        status: 'paused',
        completedAt: null,
      })
      yield* notifyProgress(config.scrapeRunId, startedAt, config.onProgress)
      return
    }

    yield* updateScrapeRun(config.scrapeRunId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    })
    yield* notifyProgress(config.scrapeRunId, startedAt, config.onProgress)
  })

  return scrapeEffect.pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        yield* updateScrapeRun(config.scrapeRunId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
        }).pipe(Effect.catchAll(() => Effect.void))
        yield* notifyProgress(config.scrapeRunId, runStartedAt, config.onProgress).pipe(
          Effect.catchAll(() => Effect.void)
        )
        return yield* Effect.fail(error)
      })
    )
  )
}

const processTileQueue = (
  scrapeRunId: string,
  query: string,
  delayMs: number,
  startedAt: string,
  shouldPause?: () => boolean,
  onProgress?: (progress: ScrapeProgress) => void
): Effect.Effect<RunOutcome, EngineError, Db> =>
  Effect.gen(function* () {
    while (true) {
      if (shouldPause?.()) {
        return 'paused'
      }

      const tile = yield* nextRunnableTile(scrapeRunId)
      if (!tile) {
        return 'completed'
      }

      yield* markTileRunning(tile.id)
      const bounds = yield* parseTileBounds(tile)
      const searchResult = yield* searchTilePages(query, bounds, delayMs)

      yield* updateTile(tile.id, { resultCount: searchResult.resultCount })

      if (shouldSubdivide(searchResult.resultCount)) {
        const childTiles = yield* subdivideTileInRun(tile.id)

        // If the tile is already at minimum size, subdivision returns no children.
        // Persist the current results so dense leaf tiles are not dropped.
        if (childTiles.length === 0) {
          yield* persistTilePlaces(scrapeRunId, searchResult.places, delayMs)
        }

        yield* notifyProgress(scrapeRunId, startedAt, onProgress)
        continue
      }

      yield* persistTilePlaces(scrapeRunId, searchResult.places, delayMs)
      yield* markTileCompleted(tile.id, searchResult.resultCount)
      yield* notifyProgress(scrapeRunId, startedAt, onProgress)
    }
  })

const notifyProgress = (
  scrapeRunId: string,
  startedAt: string,
  onProgress?: (progress: ScrapeProgress) => void
): Effect.Effect<void, EngineError, Db> =>
  Effect.gen(function* () {
    if (!onProgress) {
      return
    }

    const scrapeRun = yield* getScrapeRun(scrapeRunId)
    const parsedStartedAt = Date.parse(scrapeRun.startedAt ?? startedAt)
    const elapsedMs = Number.isFinite(parsedStartedAt) ? Math.max(0, Date.now() - parsedStartedAt) : 0

    yield* Effect.sync(() =>
      onProgress({
        scrapeRunId,
        status: scrapeRun.status,
        tilesTotal: scrapeRun.tilesTotal,
        tilesCompleted: scrapeRun.tilesCompleted,
        tilesSubdivided: scrapeRun.tilesSubdivided,
        placesFound: scrapeRun.placesFound,
        placesUnique: scrapeRun.placesUnique,
        elapsedMs,
      })
    )
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
        locationRestriction: bounds,
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

const sleep = (delayMs: number): Effect.Effect<void, ScrapeError> =>
  Effect.tryPromise({
    try: () => new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
    catch: (cause) =>
      new ScrapeError({
        message: `Failed during scrape delay of ${delayMs}ms`,
        cause,
      }),
  })
