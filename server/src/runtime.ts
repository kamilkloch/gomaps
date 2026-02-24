import { ManagedRuntime } from 'effect'
import { DbLive } from './db/Db.js'

const dbPath = process.env.DB_PATH ?? 'data/gomaps.db'

export const appRuntime = ManagedRuntime.make(DbLive(dbPath))
