import { Effect } from 'effect'
import { Db } from './Db.js'
import { DbError } from '../errors.js'

const TRUNCATE_TABLES_IN_ORDER = [
  'shortlist_entries',
  'shortlists',
  'reviews',
  'place_scrape_runs',
  'tiles',
  'scrape_runs',
  'places',
  'projects',
] as const

export const truncateAllTables = (): Effect.Effect<void, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    Effect.try({
      try: () => {
        db.exec('BEGIN')
        try {
          for (const table of TRUNCATE_TABLES_IN_ORDER) {
            db.prepare(`DELETE FROM ${table}`).run()
          }
          db.exec('COMMIT')
        }
        catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      },
      catch: (error) =>
        new DbError({
          message: `Failed to truncate test database tables: ${String(error)}`,
          cause: error,
        }),
    })
  )
