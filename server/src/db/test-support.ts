import { Effect } from 'effect'
import { Db } from './Db.js'
import { tryDb } from './effect-helpers.js'
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
    tryDb('truncate test database tables', () => {
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
    })
  )
