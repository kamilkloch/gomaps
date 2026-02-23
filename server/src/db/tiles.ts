import { randomUUID } from 'node:crypto'
import { getDatabase } from './schema.js'
import type { Tile } from './types.js'

export function createTile(
  scrapeRunId: string,
  bounds: string,
  zoomLevel: number,
  parentTileId?: string
): Tile {
  const db = getDatabase()
  const id = randomUUID()
  db.prepare(
    'INSERT INTO tiles (id, scrape_run_id, bounds, zoom_level, parent_tile_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, scrapeRunId, bounds, zoomLevel, parentTileId ?? null)
  return getTile(id)!
}

export function getTile(id: string): Tile | undefined {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM tiles WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!row) return undefined
  return mapTile(row)
}

export function listTiles(scrapeRunId: string): Tile[] {
  const db = getDatabase()
  const rows = db
    .prepare('SELECT * FROM tiles WHERE scrape_run_id = ?')
    .all(scrapeRunId) as Record<string, unknown>[]
  return rows.map(mapTile)
}

export function updateTile(
  id: string,
  updates: Partial<Pick<Tile, 'status' | 'resultCount'>>
): Tile | undefined {
  const db = getDatabase()
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

  if (sets.length === 0) return getTile(id)
  values.push(id)
  db.prepare(`UPDATE tiles SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return getTile(id)
}

export function deleteTile(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM tiles WHERE id = ?').run(id)
  return result.changes > 0
}

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
