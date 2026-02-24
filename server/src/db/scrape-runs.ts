import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { Db } from './Db.js'
import type { ScrapeRun } from './types.js'
import { DbError, NotFoundError } from '../errors.js'

export const createScrapeRun = (projectId: string, query: string): Effect.Effect<ScrapeRun, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    Effect.try({
      try: () => {
        const id = randomUUID()
        db.prepare(
          'INSERT INTO scrape_runs (id, project_id, query) VALUES (?, ?, ?)'
        ).run(id, projectId, query)
        const row = db.prepare('SELECT * FROM scrape_runs WHERE id = ?').get(id) as Record<string, unknown>
        return mapScrapeRun(row)
      },
      catch: (e) => new DbError({ message: `Failed to create scrape run: ${String(e)}`, cause: e }),
    })
  )

export const getScrapeRun = (id: string): Effect.Effect<ScrapeRun, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db
    const row = yield* Effect.try({
      try: () =>
        db.prepare('SELECT * FROM scrape_runs WHERE id = ?').get(id) as
          | Record<string, unknown>
          | undefined,
      catch: (e) => new DbError({ message: `Failed to get scrape run: ${String(e)}`, cause: e }),
    })
    if (!row) {
      return yield* Effect.fail(new NotFoundError({ entity: 'ScrapeRun', id }))
    }
    return mapScrapeRun(row)
  })

export const listScrapeRuns = (projectId: string): Effect.Effect<ScrapeRun[], DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    Effect.try({
      try: () => {
        const rows = db
          .prepare('SELECT * FROM scrape_runs WHERE project_id = ? ORDER BY started_at DESC')
          .all(projectId) as Record<string, unknown>[]
        return rows.map(mapScrapeRun)
      },
      catch: (e) => new DbError({ message: `Failed to list scrape runs: ${String(e)}`, cause: e }),
    })
  )

export const updateScrapeRun = (
  id: string,
  updates: Partial<Pick<ScrapeRun, 'status' | 'tilesTotal' | 'tilesCompleted' | 'tilesSubdivided' | 'placesFound' | 'placesUnique' | 'startedAt' | 'completedAt'>>
): Effect.Effect<ScrapeRun, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db
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

    if (sets.length === 0) return yield* getScrapeRun(id)
    values.push(id)
    yield* Effect.try({
      try: () => {
        db.prepare(`UPDATE scrape_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values)
      },
      catch: (e) => new DbError({ message: `Failed to update scrape run: ${String(e)}`, cause: e }),
    })
    return yield* getScrapeRun(id)
  })

export const deleteScrapeRun = (id: string): Effect.Effect<boolean, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    Effect.try({
      try: () => {
        const result = db.prepare('DELETE FROM scrape_runs WHERE id = ?').run(id)
        return result.changes > 0
      },
      catch: (e) => new DbError({ message: `Failed to delete scrape run: ${String(e)}`, cause: e }),
    })
  )

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
