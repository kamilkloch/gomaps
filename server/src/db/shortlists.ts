import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { Db } from './Db.js'
import { tryDb } from './effect-helpers.js'
import type { Shortlist, ShortlistEntry } from './types.js'
import { DbError, NotFoundError } from '../errors.js'

export const createShortlist = (projectId: string, name: string): Effect.Effect<Shortlist, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('create shortlist', () => {
        const id = randomUUID()
        db.prepare(
          'INSERT INTO shortlists (id, project_id, name) VALUES (?, ?, ?)'
        ).run(id, projectId, name)
        const row = db.prepare('SELECT * FROM shortlists WHERE id = ?').get(id) as Record<string, unknown>
        return mapShortlist(row)
    })
  )

export const getShortlist = (id: string): Effect.Effect<Shortlist, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db
    const row = yield* tryDb('get shortlist', () =>
        db.prepare('SELECT * FROM shortlists WHERE id = ?').get(id) as
          | Record<string, unknown>
          | undefined)
    if (!row) {
      return yield* Effect.fail(new NotFoundError({ entity: 'Shortlist', id }))
    }
    return mapShortlist(row)
  })

export const listShortlists = (projectId: string): Effect.Effect<Shortlist[], DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('list shortlists', () => {
        const rows = db
          .prepare('SELECT * FROM shortlists WHERE project_id = ? ORDER BY rowid DESC')
          .all(projectId) as Record<string, unknown>[]
        return rows.map(mapShortlist)
    })
  )

export const updateShortlist = (id: string, name: string): Effect.Effect<Shortlist, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db
    yield* tryDb('update shortlist', () => db.prepare('UPDATE shortlists SET name = ? WHERE id = ?').run(name, id))
    return yield* getShortlist(id)
  })

export const deleteShortlist = (id: string): Effect.Effect<boolean, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('delete shortlist', () => {
        const result = db.prepare('DELETE FROM shortlists WHERE id = ?').run(id)
        return result.changes > 0
    })
  )

export const addShortlistEntry = (
  shortlistId: string,
  placeId: string,
  notes?: string
): Effect.Effect<ShortlistEntry, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('add shortlist entry', () => {
        db.prepare(
          'INSERT OR REPLACE INTO shortlist_entries (shortlist_id, place_id, notes) VALUES (?, ?, ?)'
        ).run(shortlistId, placeId, notes ?? '')
        const row = db
          .prepare('SELECT * FROM shortlist_entries WHERE shortlist_id = ? AND place_id = ?')
          .get(shortlistId, placeId) as Record<string, unknown>
        return mapShortlistEntry(row)
    })
  )

export const getShortlistEntry = (
  shortlistId: string,
  placeId: string
): Effect.Effect<ShortlistEntry, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db
    const row = yield* tryDb('get shortlist entry', () =>
        db
          .prepare('SELECT * FROM shortlist_entries WHERE shortlist_id = ? AND place_id = ?')
          .get(shortlistId, placeId) as Record<string, unknown> | undefined)
    if (!row) {
      return yield* Effect.fail(new NotFoundError({ entity: 'ShortlistEntry', id: `${shortlistId}/${placeId}` }))
    }
    return mapShortlistEntry(row)
  })

export const listShortlistEntries = (shortlistId: string): Effect.Effect<ShortlistEntry[], DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('list shortlist entries', () => {
        const rows = db
          .prepare('SELECT * FROM shortlist_entries WHERE shortlist_id = ? ORDER BY rowid DESC')
          .all(shortlistId) as Record<string, unknown>[]
        return rows.map(mapShortlistEntry)
    })
  )

export const updateShortlistEntryNotes = (
  shortlistId: string,
  placeId: string,
  notes: string
): Effect.Effect<ShortlistEntry, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db
    yield* tryDb('update shortlist entry notes', () => {
        db.prepare(
          'UPDATE shortlist_entries SET notes = ? WHERE shortlist_id = ? AND place_id = ?'
        ).run(notes, shortlistId, placeId)
    })
    return yield* getShortlistEntry(shortlistId, placeId)
  })

export const removeShortlistEntry = (shortlistId: string, placeId: string): Effect.Effect<boolean, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('remove shortlist entry', () => {
        const result = db
          .prepare('DELETE FROM shortlist_entries WHERE shortlist_id = ? AND place_id = ?')
          .run(shortlistId, placeId)
        return result.changes > 0
    })
  )

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
