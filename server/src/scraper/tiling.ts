import { Effect } from 'effect'
import {
  createTile,
  getScrapeRun,
  getTile,
  updateScrapeRun,
  updateTile,
} from '../db/index.js'
import type { Db } from '../db/Db.js'
import type { ScrapeRun, Tile } from '../db/index.js'
import type { DbError, NotFoundError } from '../errors.js'
import { ScrapeError } from '../errors.js'

export interface Bounds {
  sw: {
    lat: number
    lng: number
  }
  ne: {
    lat: number
    lng: number
  }
}

export interface GeneratedTile {
  bounds: Bounds
  zoomLevel: number
}

export interface TileProgress {
  tilesTotal: number
  tilesCompleted: number
  tilesSubdivided: number
  placesFound: number
}

const DEFAULT_TILE_SIZE_DEGREES = 0.1
const MIN_TILE_SIZE_DEGREES = 0.01
const DEFAULT_SUBDIVISION_THRESHOLD = 60

export const generateTiles = (
  bounds: Bounds,
  tileSizeDegrees = DEFAULT_TILE_SIZE_DEGREES
): GeneratedTile[] => {
  const normalizedBounds = validateBounds(bounds)
  if (tileSizeDegrees <= 0) {
    throw new ScrapeError({ message: 'Tile size must be greater than zero' })
  }

  const tiles: GeneratedTile[] = []

  for (let lat = normalizedBounds.sw.lat; lat < normalizedBounds.ne.lat; lat += tileSizeDegrees) {
    for (let lng = normalizedBounds.sw.lng; lng < normalizedBounds.ne.lng; lng += tileSizeDegrees) {
      tiles.push({
        bounds: {
          sw: {
            lat,
            lng,
          },
          ne: {
            lat: Math.min(lat + tileSizeDegrees, normalizedBounds.ne.lat),
            lng: Math.min(lng + tileSizeDegrees, normalizedBounds.ne.lng),
          },
        },
        zoomLevel: 0,
      })
    }
  }

  return tiles
}

export const subdivideTile = (
  tile: GeneratedTile,
  minTileSizeDegrees = MIN_TILE_SIZE_DEGREES
): GeneratedTile[] => {
  const bounds = validateBounds(tile.bounds)
  if (minTileSizeDegrees <= 0) {
    throw new ScrapeError({ message: 'Minimum tile size must be greater than zero' })
  }

  const latDelta = bounds.ne.lat - bounds.sw.lat
  const lngDelta = bounds.ne.lng - bounds.sw.lng
  const halfLat = latDelta / 2
  const halfLng = lngDelta / 2

  if (halfLat < minTileSizeDegrees || halfLng < minTileSizeDegrees) {
    return []
  }

  const midLat = bounds.sw.lat + halfLat
  const midLng = bounds.sw.lng + halfLng

  return [
    {
      bounds: {
        sw: { lat: bounds.sw.lat, lng: bounds.sw.lng },
        ne: { lat: midLat, lng: midLng },
      },
      zoomLevel: tile.zoomLevel + 1,
    },
    {
      bounds: {
        sw: { lat: bounds.sw.lat, lng: midLng },
        ne: { lat: midLat, lng: bounds.ne.lng },
      },
      zoomLevel: tile.zoomLevel + 1,
    },
    {
      bounds: {
        sw: { lat: midLat, lng: bounds.sw.lng },
        ne: { lat: bounds.ne.lat, lng: midLng },
      },
      zoomLevel: tile.zoomLevel + 1,
    },
    {
      bounds: {
        sw: { lat: midLat, lng: midLng },
        ne: { lat: bounds.ne.lat, lng: bounds.ne.lng },
      },
      zoomLevel: tile.zoomLevel + 1,
    },
  ]
}

export const shouldSubdivide = (
  resultCount: number,
  threshold = DEFAULT_SUBDIVISION_THRESHOLD
): boolean => resultCount >= threshold

export const initializeTilesForRun = (
  scrapeRunId: string,
  bounds: Bounds,
  tileSizeDegrees = DEFAULT_TILE_SIZE_DEGREES
): Effect.Effect<Tile[], DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const generatedTiles = generateTiles(bounds, tileSizeDegrees)
    const createdTiles = yield* Effect.forEach(generatedTiles, (tile) =>
      createTile(scrapeRunId, JSON.stringify(tile.bounds), tile.zoomLevel)
    )

    if (createdTiles.length === 0) {
      return createdTiles
    }

    const scrapeRun = yield* getScrapeRun(scrapeRunId)
    yield* updateScrapeRun(scrapeRunId, {
      tilesTotal: scrapeRun.tilesTotal + createdTiles.length,
    })
    return createdTiles
  })

export const markTileRunning = (tileId: string): Effect.Effect<Tile, DbError | NotFoundError, Db> =>
  updateTile(tileId, { status: 'running' })

export const markTileCompleted = (
  tileId: string,
  resultCount: number
): Effect.Effect<Tile, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const tile = yield* updateTile(tileId, {
      status: 'completed',
      resultCount,
    })

    const scrapeRun = yield* getScrapeRun(tile.scrapeRunId)
    yield* updateScrapeRun(tile.scrapeRunId, {
      tilesCompleted: scrapeRun.tilesCompleted + 1,
      placesFound: scrapeRun.placesFound + resultCount,
    })

    return tile
  })

export const subdivideTileInRun = (
  tileId: string,
  minTileSizeDegrees = MIN_TILE_SIZE_DEGREES
): Effect.Effect<Tile[], DbError | NotFoundError | ScrapeError, Db> =>
  Effect.gen(function* () {
    const tile = yield* getTile(tileId)
    const parsedBounds = yield* parseBounds(tile.bounds)

    const children = subdivideTile(
      {
        bounds: parsedBounds,
        zoomLevel: tile.zoomLevel,
      },
      minTileSizeDegrees
    )

    if (children.length === 0) {
      yield* markTileCompleted(tile.id, tile.resultCount)
      return []
    }

    const createdChildren = yield* Effect.forEach(children, (child) =>
      createTile(tile.scrapeRunId, JSON.stringify(child.bounds), child.zoomLevel, tile.id)
    )

    yield* updateTile(tile.id, { status: 'subdivided' })

    const scrapeRun = yield* getScrapeRun(tile.scrapeRunId)
    yield* updateScrapeRun(tile.scrapeRunId, {
      tilesTotal: scrapeRun.tilesTotal + createdChildren.length,
      tilesSubdivided: scrapeRun.tilesSubdivided + 1,
    })

    return createdChildren
  })

export const getRunTileProgress = (
  scrapeRunId: string
): Effect.Effect<TileProgress, DbError | NotFoundError, Db> =>
  Effect.map(getScrapeRun(scrapeRunId), mapProgress)

const mapProgress = (scrapeRun: ScrapeRun): TileProgress => ({
  tilesTotal: scrapeRun.tilesTotal,
  tilesCompleted: scrapeRun.tilesCompleted,
  tilesSubdivided: scrapeRun.tilesSubdivided,
  placesFound: scrapeRun.placesFound,
})

const parseBounds = (bounds: string): Effect.Effect<Bounds, ScrapeError> =>
  Effect.try({
    try: () => validateBounds(JSON.parse(bounds) as Bounds),
    catch: (cause) =>
      new ScrapeError({
        message: `Failed to parse tile bounds: ${String(cause)}`,
        cause,
      }),
  })

const validateBounds = (bounds: Bounds): Bounds => {
  if (
    Number.isNaN(bounds.sw.lat) ||
    Number.isNaN(bounds.sw.lng) ||
    Number.isNaN(bounds.ne.lat) ||
    Number.isNaN(bounds.ne.lng)
  ) {
    throw new ScrapeError({ message: 'Bounds must contain valid numbers' })
  }

  if (bounds.sw.lat >= bounds.ne.lat || bounds.sw.lng >= bounds.ne.lng) {
    throw new ScrapeError({ message: 'Bounds are invalid: southwest must be lower than northeast' })
  }

  return bounds
}
