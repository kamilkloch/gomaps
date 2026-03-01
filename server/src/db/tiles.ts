import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { Db } from './Db.js'
import { tryDb } from './effect-helpers.js'
import type { Tile } from './types.js'
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
