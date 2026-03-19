import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { Db } from './Db.js'
import { tryDb } from './effect-helpers.js'
import type {
  ProjectAggregateCoverage,
  ProjectAggregateCoverageSourceTile,
  Tile,
} from './types.js'
import { DbError, NotFoundError } from '../errors.js'

export const createTile = (
  scrapeRunId: string,
  bounds: string,
  zoomLevel: number,
  parentTileId?: string
): Effect.Effect<Tile, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('create tile', () => {
        const id = randomUUID()
        db.prepare(
          'INSERT INTO tiles (id, scrape_run_id, bounds, zoom_level, parent_tile_id) VALUES (?, ?, ?, ?, ?)'
        ).run(id, scrapeRunId, bounds, zoomLevel, parentTileId ?? null)
        const row = db.prepare('SELECT * FROM tiles WHERE id = ?').get(id) as Record<string, unknown>
        return mapTile(row)
    })
  )

export const getTile = (id: string): Effect.Effect<Tile, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db
    const row = yield* tryDb('get tile', () =>
        db.prepare('SELECT * FROM tiles WHERE id = ?').get(id) as
          | Record<string, unknown>
          | undefined)
    if (!row) {
      return yield* Effect.fail(new NotFoundError({ entity: 'Tile', id }))
    }
    return mapTile(row)
  })

export const listTiles = (scrapeRunId: string): Effect.Effect<Tile[], DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('list tiles', () => {
        const rows = db
          .prepare('SELECT * FROM tiles WHERE scrape_run_id = ?')
          .all(scrapeRunId) as Record<string, unknown>[]
        return rows.map(mapTile)
    })
  )

export const getProjectAggregateCoverage = (
  projectId: string,
): Effect.Effect<ProjectAggregateCoverage, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('get project aggregate coverage', () => {
      const rows = db.prepare(
        `
          SELECT
            tiles.bounds AS bounds,
            tiles.scrape_run_id AS scrape_run_id,
            scrape_runs.query AS query,
            scrape_runs.completed_at AS completed_at
          FROM tiles
          INNER JOIN scrape_runs
            ON scrape_runs.id = tiles.scrape_run_id
          WHERE scrape_runs.project_id = ?
            AND scrape_runs.kind = 'discovery'
            AND scrape_runs.status = 'completed'
            AND tiles.status = 'completed'
            AND NOT EXISTS (
              SELECT 1
              FROM tiles child_tiles
              WHERE child_tiles.parent_tile_id = tiles.id
            )
          ORDER BY scrape_runs.completed_at DESC, tiles.rowid DESC
        `
      ).all(projectId) as Array<{
        bounds: string
        scrape_run_id: string
        query: string
        completed_at: string | null
      }>

      const sourceTiles = rows.flatMap((row) => {
        const bounds = parseCoverageBounds(row.bounds)
        if (!bounds) {
          return []
        }

        return [{
          scrapeRunId: row.scrape_run_id,
          query: row.query,
          completedAt: row.completed_at,
          bounds: JSON.stringify(bounds),
        } satisfies ProjectAggregateCoverageSourceTile]
      })

      return {
        completedDiscoveryRunsCount: new Set(sourceTiles.map((tile) => tile.scrapeRunId)).size,
        coverageRectangles: mergeCoverageBounds(
          sourceTiles.map((tile) => parseCoverageBounds(tile.bounds)).filter(isDefined),
        ).map((bounds) => ({
          bounds: JSON.stringify(bounds),
        })),
        sourceTiles,
      }
    })
  )

export const updateTile = (
  id: string,
  updates: Partial<Pick<Tile, 'status' | 'resultCount'>>
): Effect.Effect<Tile, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db
    const sets: string[] = []
    const values: unknown[] = []

    if (updates.status !== undefined) {
      sets.push('status = ?')
      values.push(updates.status)
    }
    if (updates.resultCount !== undefined) {
      sets.push('result_count = ?')
      values.push(updates.resultCount)
    }

    if (sets.length === 0) return yield* getTile(id)
    values.push(id)
    yield* tryDb('update tile', () => {
        db.prepare(`UPDATE tiles SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    })
    return yield* getTile(id)
  })

export const deleteTile = (id: string): Effect.Effect<boolean, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('delete tile', () => {
        const result = db.prepare('DELETE FROM tiles WHERE id = ?').run(id)
        return result.changes > 0
    })
  )

function mapTile(row: Record<string, unknown>): Tile {
  return {
    id: row.id as string,
    scrapeRunId: row.scrape_run_id as string,
    bounds: row.bounds as string,
    zoomLevel: row.zoom_level as number,
    status: row.status as Tile['status'],
    resultCount: row.result_count as number,
    parentTileId: row.parent_tile_id as string | null,
  }
}

interface CoverageBounds {
  sw: { lat: number; lng: number }
  ne: { lat: number; lng: number }
}

interface CoverageSegment {
  westIndex: number
  eastIndex: number
  south: number
  north: number
}

const parseCoverageBounds = (rawBounds: string): CoverageBounds | null => {
  try {
    const parsed = JSON.parse(rawBounds) as CoverageBounds
    if (
      Number.isFinite(parsed.sw.lat)
      && Number.isFinite(parsed.sw.lng)
      && Number.isFinite(parsed.ne.lat)
      && Number.isFinite(parsed.ne.lng)
      && parsed.sw.lat < parsed.ne.lat
      && parsed.sw.lng < parsed.ne.lng
    ) {
      return parsed
    }
  }
  catch {
    return null
  }

  return null
}

const mergeCoverageBounds = (boundsList: CoverageBounds[]): CoverageBounds[] => {
  if (boundsList.length === 0) {
    return []
  }

  const latPoints = Array.from(
    new Set(boundsList.flatMap((bounds) => [bounds.sw.lat, bounds.ne.lat])),
  ).sort((left, right) => left - right)
  const lngPoints = Array.from(
    new Set(boundsList.flatMap((bounds) => [bounds.sw.lng, bounds.ne.lng])),
  ).sort((left, right) => left - right)

  const coveredCells = latPoints.slice(0, -1).map(() =>
    lngPoints.slice(0, -1).map(() => false),
  )

  for (const bounds of boundsList) {
    for (let latIndex = 0; latIndex < latPoints.length - 1; latIndex += 1) {
      const south = latPoints[latIndex]
      const north = latPoints[latIndex + 1]
      if (south < bounds.sw.lat || north > bounds.ne.lat) {
        continue
      }

      for (let lngIndex = 0; lngIndex < lngPoints.length - 1; lngIndex += 1) {
        const west = lngPoints[lngIndex]
        const east = lngPoints[lngIndex + 1]
        if (west < bounds.sw.lng || east > bounds.ne.lng) {
          continue
        }

        coveredCells[latIndex][lngIndex] = true
      }
    }
  }

  const activeSegments = new Map<string, CoverageSegment>()
  const mergedBounds: CoverageBounds[] = []

  for (let latIndex = 0; latIndex < coveredCells.length; latIndex += 1) {
    const rowSegments: CoverageSegment[] = []
    let lngIndex = 0

    while (lngIndex < coveredCells[latIndex].length) {
      if (!coveredCells[latIndex][lngIndex]) {
        lngIndex += 1
        continue
      }

      const startIndex = lngIndex
      while (lngIndex < coveredCells[latIndex].length && coveredCells[latIndex][lngIndex]) {
        lngIndex += 1
      }

      rowSegments.push({
        westIndex: startIndex,
        eastIndex: lngIndex,
        south: latPoints[latIndex],
        north: latPoints[latIndex + 1],
      })
    }

    const nextActiveSegments = new Map<string, CoverageSegment>()

    for (const segment of rowSegments) {
      const key = `${segment.westIndex}:${segment.eastIndex}`
      const existing = activeSegments.get(key)
      if (existing) {
        nextActiveSegments.set(key, {
          ...existing,
          north: segment.north,
        })
        activeSegments.delete(key)
        continue
      }

      nextActiveSegments.set(key, segment)
    }

    for (const segment of activeSegments.values()) {
      mergedBounds.push(segmentToBounds(segment, lngPoints))
    }

    activeSegments.clear()
    for (const [key, segment] of nextActiveSegments.entries()) {
      activeSegments.set(key, segment)
    }
  }

  for (const segment of activeSegments.values()) {
    mergedBounds.push(segmentToBounds(segment, lngPoints))
  }

  return mergedBounds
}

const segmentToBounds = (
  segment: CoverageSegment,
  lngPoints: number[],
): CoverageBounds => ({
  sw: {
    lat: segment.south,
    lng: lngPoints[segment.westIndex],
  },
  ne: {
    lat: segment.north,
    lng: lngPoints[segment.eastIndex],
  },
})

const isDefined = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined
