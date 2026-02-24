import type Database from 'better-sqlite3'
import { Context, Effect, Layer } from 'effect'
import { createDatabase } from './schema.js'

export class Db extends Context.Tag('Db')<Db, { readonly db: Database.Database }>() {}

export const DbLive = (dbPath: string): Layer.Layer<Db> =>
  Layer.scoped(
    Db,
    Effect.acquireRelease(
      Effect.sync(() => ({ db: createDatabase(dbPath) })),
      ({ db }) => Effect.sync(() => db.close())
    )
  )
