import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { getDatabase } from './schema.js'
import type { Shortlist, ShortlistEntry } from './types.js'
import { DbError, NotFoundError } from '../errors.js'

export const createShortlist = (projectId: string, name: string): Effect.Effect<Shortlist, DbError> =>
  Effect.try({
    try: () => {
      const db = getDatabase()
      const id = randomUUID()
      db.prepare(
        'INSERT INTO shortlists (id, project_id, name) VALUES (?, ?, ?)'
      ).run(id, projectId, name)
      const row = db.prepare('SELECT * FROM shortlists WHERE id = ?').get(id) as Record<string, unknown>
      return mapShortlist(row)
    },
    catch: (e) => new DbError({ message: `Failed to create shortlist: ${String(e)}`, cause: e }),
  })

export const getShortlist = (id: string): Effect.Effect<Shortlist, DbError | NotFoundError> =>
  Effect.gen(function* () {
    const row = yield* Effect.try({
      try: () => {
        const db = getDatabase()
        return db.prepare('SELECT * FROM shortlists WHERE id = ?').get(id) as
          | Record<string, unknown>
          | undefined
      },
      catch: (e) => new DbError({ message: `Failed to get shortlist: ${String(e)}`, cause: e }),
    })
    if (!row) {
      return yield* Effect.fail(new NotFoundError({ entity: 'Shortlist', id }))
    }
    return mapShortlist(row)
  })

export const listShortlists = (projectId: string): Effect.Effect<Shortlist[], DbError> =>
  Effect.try({
    try: () => {
      const db = getDatabase()
      const rows = db
        .prepare('SELECT * FROM shortlists WHERE project_id = ?')
        .all(projectId) as Record<string, unknown>[]
      return rows.map(mapShortlist)
    },
    catch: (e) => new DbError({ message: `Failed to list shortlists: ${String(e)}`, cause: e }),
  })

export const updateShortlist = (id: string, name: string): Effect.Effect<Shortlist, DbError | NotFoundError> =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => {
        const db = getDatabase()
        db.prepare('UPDATE shortlists SET name = ? WHERE id = ?').run(name, id)
      },
      catch: (e) => new DbError({ message: `Failed to update shortlist: ${String(e)}`, cause: e }),
    })
    return yield* getShortlist(id)
  })

export const deleteShortlist = (id: string): Effect.Effect<boolean, DbError> =>
  Effect.try({
    try: () => {
      const db = getDatabase()
      const result = db.prepare('DELETE FROM shortlists WHERE id = ?').run(id)
      return result.changes > 0
    },
    catch: (e) => new DbError({ message: `Failed to delete shortlist: ${String(e)}`, cause: e }),
  })

export const addShortlistEntry = (
  shortlistId: string,
  placeId: string,
  notes?: string
): Effect.Effect<ShortlistEntry, DbError> =>
  Effect.try({
    try: () => {
      const db = getDatabase()
      db.prepare(
        'INSERT OR REPLACE INTO shortlist_entries (shortlist_id, place_id, notes) VALUES (?, ?, ?)'
      ).run(shortlistId, placeId, notes ?? '')
      const row = db
        .prepare('SELECT * FROM shortlist_entries WHERE shortlist_id = ? AND place_id = ?')
        .get(shortlistId, placeId) as Record<string, unknown>
      return mapShortlistEntry(row)
    },
    catch: (e) => new DbError({ message: `Failed to add shortlist entry: ${String(e)}`, cause: e }),
  })

export const getShortlistEntry = (
  shortlistId: string,
  placeId: string
): Effect.Effect<ShortlistEntry, DbError | NotFoundError> =>
  Effect.gen(function* () {
    const row = yield* Effect.try({
      try: () => {
        const db = getDatabase()
        return db
          .prepare('SELECT * FROM shortlist_entries WHERE shortlist_id = ? AND place_id = ?')
          .get(shortlistId, placeId) as Record<string, unknown> | undefined
      },
      catch: (e) => new DbError({ message: `Failed to get shortlist entry: ${String(e)}`, cause: e }),
    })
    if (!row) {
      return yield* Effect.fail(new NotFoundError({ entity: 'ShortlistEntry', id: `${shortlistId}/${placeId}` }))
    }
    return mapShortlistEntry(row)
  })

export const listShortlistEntries = (shortlistId: string): Effect.Effect<ShortlistEntry[], DbError> =>
  Effect.try({
    try: () => {
      const db = getDatabase()
      const rows = db
        .prepare('SELECT * FROM shortlist_entries WHERE shortlist_id = ?')
        .all(shortlistId) as Record<string, unknown>[]
      return rows.map(mapShortlistEntry)
    },
    catch: (e) => new DbError({ message: `Failed to list shortlist entries: ${String(e)}`, cause: e }),
  })

export const updateShortlistEntryNotes = (
  shortlistId: string,
  placeId: string,
  notes: string
): Effect.Effect<ShortlistEntry, DbError | NotFoundError> =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => {
        const db = getDatabase()
        db.prepare(
          'UPDATE shortlist_entries SET notes = ? WHERE shortlist_id = ? AND place_id = ?'
        ).run(notes, shortlistId, placeId)
      },
      catch: (e) => new DbError({ message: `Failed to update shortlist entry notes: ${String(e)}`, cause: e }),
    })
    return yield* getShortlistEntry(shortlistId, placeId)
  })

export const removeShortlistEntry = (shortlistId: string, placeId: string): Effect.Effect<boolean, DbError> =>
  Effect.try({
    try: () => {
      const db = getDatabase()
      const result = db
        .prepare('DELETE FROM shortlist_entries WHERE shortlist_id = ? AND place_id = ?')
        .run(shortlistId, placeId)
      return result.changes > 0
    },
    catch: (e) => new DbError({ message: `Failed to remove shortlist entry: ${String(e)}`, cause: e }),
  })

function mapShortlist(row: Record<string, unknown>): Shortlist {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
  }
}

function mapShortlistEntry(row: Record<string, unknown>): ShortlistEntry {
  return {
    shortlistId: row.shortlist_id as string,
    placeId: row.place_id as string,
    notes: row.notes as string,
  }
}
