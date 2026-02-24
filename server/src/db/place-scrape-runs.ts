import { Effect } from 'effect'
import { getDatabase } from './schema.js'
import type { PlaceScrapeRun } from './types.js'
import { DbError } from '../errors.js'

export const linkPlaceToScrapeRun = (placeId: string, scrapeRunId: string): Effect.Effect<void, DbError> =>
  Effect.try({
    try: () => {
      const db = getDatabase()
      db.prepare(
        'INSERT OR IGNORE INTO place_scrape_runs (place_id, scrape_run_id) VALUES (?, ?)'
      ).run(placeId, scrapeRunId)
    },
    catch: (e) => new DbError({ message: `Failed to link place to scrape run: ${String(e)}`, cause: e }),
  })

export const listPlaceScrapeRuns = (scrapeRunId: string): Effect.Effect<PlaceScrapeRun[], DbError> =>
  Effect.try({
    try: () => {
      const db = getDatabase()
      const rows = db
        .prepare('SELECT * FROM place_scrape_runs WHERE scrape_run_id = ?')
        .all(scrapeRunId) as Record<string, unknown>[]
      return rows.map((row) => ({
        placeId: row.place_id as string,
        scrapeRunId: row.scrape_run_id as string,
      }))
    },
    catch: (e) => new DbError({ message: `Failed to list place scrape runs: ${String(e)}`, cause: e }),
  })

export const unlinkPlaceFromScrapeRun = (placeId: string, scrapeRunId: string): Effect.Effect<boolean, DbError> =>
  Effect.try({
    try: () => {
      const db = getDatabase()
      const result = db
        .prepare('DELETE FROM place_scrape_runs WHERE place_id = ? AND scrape_run_id = ?')
        .run(placeId, scrapeRunId)
      return result.changes > 0
    },
    catch: (e) => new DbError({ message: `Failed to unlink place from scrape run: ${String(e)}`, cause: e }),
  })
