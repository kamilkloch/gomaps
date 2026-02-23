import { getDatabase } from './schema.js'
import type { PlaceScrapeRun } from './types.js'

export function linkPlaceToScrapeRun(placeId: string, scrapeRunId: string): void {
  const db = getDatabase()
  db.prepare(
    'INSERT OR IGNORE INTO place_scrape_runs (place_id, scrape_run_id) VALUES (?, ?)'
  ).run(placeId, scrapeRunId)
}

export function listPlaceScrapeRuns(scrapeRunId: string): PlaceScrapeRun[] {
  const db = getDatabase()
  const rows = db
    .prepare('SELECT * FROM place_scrape_runs WHERE scrape_run_id = ?')
    .all(scrapeRunId) as Record<string, unknown>[]
  return rows.map((row) => ({
    placeId: row.place_id as string,
    scrapeRunId: row.scrape_run_id as string,
  }))
}

export function unlinkPlaceFromScrapeRun(placeId: string, scrapeRunId: string): boolean {
  const db = getDatabase()
  const result = db
    .prepare('DELETE FROM place_scrape_runs WHERE place_id = ? AND scrape_run_id = ?')
    .run(placeId, scrapeRunId)
  return result.changes > 0
}
