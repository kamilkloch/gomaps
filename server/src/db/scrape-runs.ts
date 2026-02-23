import { randomUUID } from 'node:crypto'
import { getDatabase } from './schema.js'
import type { ScrapeRun } from './types.js'

export function createScrapeRun(projectId: string, query: string): ScrapeRun {
  const db = getDatabase()
  const id = randomUUID()
  db.prepare(
    'INSERT INTO scrape_runs (id, project_id, query) VALUES (?, ?, ?)'
  ).run(id, projectId, query)
  return getScrapeRun(id)!
}

export function getScrapeRun(id: string): ScrapeRun | undefined {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM scrape_runs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!row) return undefined
  return mapScrapeRun(row)
}

export function listScrapeRuns(projectId: string): ScrapeRun[] {
  const db = getDatabase()
  const rows = db
    .prepare('SELECT * FROM scrape_runs WHERE project_id = ? ORDER BY started_at DESC')
    .all(projectId) as Record<string, unknown>[]
  return rows.map(mapScrapeRun)
}

export function updateScrapeRun(
  id: string,
  updates: Partial<Pick<ScrapeRun, 'status' | 'tilesTotal' | 'tilesCompleted' | 'tilesSubdivided' | 'placesFound' | 'placesUnique' | 'startedAt' | 'completedAt'>>
): ScrapeRun | undefined {
  const db = getDatabase()
  const sets: string[] = []
  const values: unknown[] = []

  const fieldMap: Record<string, string> = {
    status: 'status',
    tilesTotal: 'tiles_total',
    tilesCompleted: 'tiles_completed',
    tilesSubdivided: 'tiles_subdivided',
    placesFound: 'places_found',
    placesUnique: 'places_unique',
    startedAt: 'started_at',
    completedAt: 'completed_at',
  }

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in updates) {
      sets.push(`${col} = ?`)
      values.push((updates as Record<string, unknown>)[key] ?? null)
    }
  }

  if (sets.length === 0) return getScrapeRun(id)
  values.push(id)
  db.prepare(`UPDATE scrape_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return getScrapeRun(id)
}

export function deleteScrapeRun(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM scrape_runs WHERE id = ?').run(id)
  return result.changes > 0
}

function mapScrapeRun(row: Record<string, unknown>): ScrapeRun {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    query: row.query as string,
    status: row.status as ScrapeRun['status'],
    tilesTotal: row.tiles_total as number,
    tilesCompleted: row.tiles_completed as number,
    tilesSubdivided: row.tiles_subdivided as number,
    placesFound: row.places_found as number,
    placesUnique: row.places_unique as number,
    startedAt: row.started_at as string | null,
    completedAt: row.completed_at as string | null,
  }
}
