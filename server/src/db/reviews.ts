import { randomUUID } from 'node:crypto'
import { getDatabase } from './schema.js'
import type { Review } from './types.js'

export function createReview(
  placeId: string,
  rating: number,
  text: string,
  relativeDate?: string
): Review {
  const db = getDatabase()
  const id = randomUUID()
  db.prepare(
    'INSERT INTO reviews (id, place_id, rating, text, relative_date) VALUES (?, ?, ?, ?, ?)'
  ).run(id, placeId, rating, text, relativeDate ?? null)
  return getReview(id)!
}

export function getReview(id: string): Review | undefined {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!row) return undefined
  return mapReview(row)
}

export function listReviews(placeId: string): Review[] {
  const db = getDatabase()
  const rows = db
    .prepare('SELECT * FROM reviews WHERE place_id = ?')
    .all(placeId) as Record<string, unknown>[]
  return rows.map(mapReview)
}

export function deleteReview(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM reviews WHERE id = ?').run(id)
  return result.changes > 0
}

export function deleteReviewsByPlace(placeId: string): number {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM reviews WHERE place_id = ?').run(placeId)
  return result.changes
}

function mapReview(row: Record<string, unknown>): Review {
  return {
    id: row.id as string,
    placeId: row.place_id as string,
    rating: row.rating as number,
    text: row.text as string,
    relativeDate: row.relative_date as string | null,
  }
}
