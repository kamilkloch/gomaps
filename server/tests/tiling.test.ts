import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, ManagedRuntime } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DbLive } from '../src/db/Db.js'
import { createProject } from '../src/db/projects.js'
import { createScrapeRun, getScrapeRun } from '../src/db/scrape-runs.js'
import { getTile, listTiles } from '../src/db/tiles.js'
import {
  generateTiles,
  getRunTileProgress,
  initializeTilesForRun,
  markTileCompleted,
  markTileRunning,
  shouldSubdivide,
  subdivideTile,
  subdivideTileInRun,
  type Bounds,
} from '../src/scraper/tiling.js'

describe('tiling', () => {
  it('generateTiles returns a coarse grid and clamps edge tiles', () => {
    const bounds: Bounds = {
      sw: { lat: 39.0, lng: 8.0 },
      ne: { lat: 39.25, lng: 8.22 },
    }

    const tiles = generateTiles(bounds, 0.1)

    expect(tiles).toHaveLength(9)
    expect(tiles[0].bounds).toEqual({
      sw: { lat: 39.0, lng: 8.0 },
      ne: { lat: 39.1, lng: 8.1 },
    })
    expect(tiles[tiles.length - 1].bounds).toEqual({
      sw: { lat: 39.2, lng: 8.2 },
      ne: { lat: 39.25, lng: 8.22 },
    })
  })

  it('subdivideTile returns 4 child tiles and increments zoom level', () => {
    const children = subdivideTile(
      {
        bounds: {
          sw: { lat: 39.0, lng: 8.0 },
          ne: { lat: 39.1, lng: 8.1 },
        },
        zoomLevel: 0,
      },
      0.01
    )

    expect(children).toHaveLength(4)
    expect(children.every((tile) => tile.zoomLevel === 1)).toBe(true)
    expect(children[0].bounds).toEqual({
      sw: { lat: 39.0, lng: 8.0 },
      ne: { lat: 39.05, lng: 8.05 },
    })
  })

  it('subdivideTile respects minimum tile size floor', () => {
    const children = subdivideTile(
      {
        bounds: {
          sw: { lat: 39.0, lng: 8.0 },
          ne: { lat: 39.01, lng: 8.01 },
        },
        zoomLevel: 2,
      },
      0.01
    )

    expect(children).toEqual([])
  })

  it('shouldSubdivide defaults to threshold 60', () => {
    expect(shouldSubdivide(59)).toBe(false)
    expect(shouldSubdivide(60)).toBe(true)
    expect(shouldSubdivide(70)).toBe(true)
    expect(shouldSubdivide(10, 10)).toBe(true)
  })
})

describe('tiling persistence', () => {
  let dbPath = ''
  let runtime: ManagedRuntime.ManagedRuntime<import('../src/db/Db.js').Db, never>

  beforeEach(() => {
    dbPath = join(tmpdir(), `gomaps-tiling-${randomUUID()}.db`)
    runtime = ManagedRuntime.make(DbLive(dbPath))
  })

  afterEach(async () => {
    await runtime.dispose()
    try {
      unlinkSync(dbPath)
    } catch {
      // ignore test db cleanup errors
    }
  })

  it('tracks tile status and scrape run progress in SQLite', async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const project = yield* createProject('Sardinia', null)
        const run = yield* createScrapeRun(project.id, 'vacation rentals')

        const initialTiles = yield* initializeTilesForRun(run.id, {
          sw: { lat: 39.0, lng: 8.0 },
          ne: { lat: 39.2, lng: 8.2 },
        })

        yield* markTileRunning(initialTiles[0].id)
        yield* markTileCompleted(initialTiles[0].id, 23)
        const children = yield* subdivideTileInRun(initialTiles[1].id)

        const updatedRun = yield* getScrapeRun(run.id)
        const progress = yield* getRunTileProgress(run.id)
        const parentTile = yield* getTile(initialTiles[1].id)
        const tiles = yield* listTiles(run.id)

        return {
          initialCount: initialTiles.length,
          childCount: children.length,
          updatedRun,
          progress,
          parentTile,
          tileCount: tiles.length,
        }
      })
    )

    expect(result.initialCount).toBe(4)
    expect(result.childCount).toBe(4)
    expect(result.parentTile.status).toBe('subdivided')

    expect(result.updatedRun.tilesTotal).toBe(8)
    expect(result.updatedRun.tilesCompleted).toBe(1)
    expect(result.updatedRun.tilesSubdivided).toBe(1)
    expect(result.updatedRun.placesFound).toBe(23)

    expect(result.progress).toEqual({
      tilesTotal: 8,
      tilesCompleted: 1,
      tilesSubdivided: 1,
      placesFound: 23,
    })

    expect(result.tileCount).toBe(8)
  })
})
