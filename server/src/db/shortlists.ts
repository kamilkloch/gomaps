import { randomUUID } from 'node:crypto'
import { getDatabase } from './schema.js'
import type { Shortlist, ShortlistEntry } from './types.js'

export function createShortlist(projectId: string, name: string): Shortlist {
  const db = getDatabase()
  const id = randomUUID()
  db.prepare(
    'INSERT INTO shortlists (id, project_id, name) VALUES (?, ?, ?)'
  ).run(id, projectId, name)
  return getShortlist(id)!
}

export function getShortlist(id: string): Shortlist | undefined {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM shortlists WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!row) return undefined
  return mapShortlist(row)
}

export function listShortlists(projectId: string): Shortlist[] {
  const db = getDatabase()
  const rows = db
    .prepare('SELECT * FROM shortlists WHERE project_id = ?')
    .all(projectId) as Record<string, unknown>[]
  return rows.map(mapShortlist)
}

export function updateShortlist(id: string, name: string): Shortlist | undefined {
  const db = getDatabase()
  db.prepare('UPDATE shortlists SET name = ? WHERE id = ?').run(name, id)
  return getShortlist(id)
}

export function deleteShortlist(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM shortlists WHERE id = ?').run(id)
  return result.changes > 0
}

export function addShortlistEntry(
  shortlistId: string,
  placeId: string,
  notes?: string
): ShortlistEntry {
  const db = getDatabase()
  db.prepare(
    'INSERT OR REPLACE INTO shortlist_entries (shortlist_id, place_id, notes) VALUES (?, ?, ?)'
  ).run(shortlistId, placeId, notes ?? '')
  return getShortlistEntry(shortlistId, placeId)!
}

export function getShortlistEntry(
  shortlistId: string,
  placeId: string
): ShortlistEntry | undefined {
  const db = getDatabase()
  const row = db
    .prepare('SELECT * FROM shortlist_entries WHERE shortlist_id = ? AND place_id = ?')
    .get(shortlistId, placeId) as Record<string, unknown> | undefined
  if (!row) return undefined
  return mapShortlistEntry(row)
}

export function listShortlistEntries(shortlistId: string): ShortlistEntry[] {
  const db = getDatabase()
  const rows = db
    .prepare('SELECT * FROM shortlist_entries WHERE shortlist_id = ?')
    .all(shortlistId) as Record<string, unknown>[]
  return rows.map(mapShortlistEntry)
}

export function updateShortlistEntryNotes(
  shortlistId: string,
  placeId: string,
  notes: string
): ShortlistEntry | undefined {
  const db = getDatabase()
  db.prepare(
    'UPDATE shortlist_entries SET notes = ? WHERE shortlist_id = ? AND place_id = ?'
  ).run(notes, shortlistId, placeId)
  return getShortlistEntry(shortlistId, placeId)
}

export function removeShortlistEntry(shortlistId: string, placeId: string): boolean {
  const db = getDatabase()
  const result = db
    .prepare('DELETE FROM shortlist_entries WHERE shortlist_id = ? AND place_id = ?')
    .run(shortlistId, placeId)
  return result.changes > 0
}

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
