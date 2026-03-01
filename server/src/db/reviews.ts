import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { Db } from './Db.js'
import { tryDb } from './effect-helpers.js'
import type { Review } from './types.js'
import { DbError, NotFoundError } from '../errors.js'

export const createReview = (
  placeId: string,
  rating: number,
  text: string,
  relativeDate?: string
): Effect.Effect<Review, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('create review', () => {
        const id = randomUUID()
        db.prepare(
          'INSERT INTO reviews (id, place_id, rating, text, relative_date) VALUES (?, ?, ?, ?, ?)'
        ).run(id, placeId, rating, text, relativeDate ?? null)
        const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as Record<string, unknown>
        return mapReview(row)
    })
  )

export const getReview = (id: string): Effect.Effect<Review, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db
    const row = yield* tryDb('get review', () =>
        db.prepare('SELECT * FROM reviews WHERE id = ?').get(id) as
          | Record<string, unknown>
          | undefined)
    if (!row) {
      return yield* Effect.fail(new NotFoundError({ entity: 'Review', id }))
    }
    return mapReview(row)
  })

export const listReviews = (placeId: string): Effect.Effect<Review[], DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('list reviews', () => {
        const rows = db
          .prepare('SELECT * FROM reviews WHERE place_id = ?')
          .all(placeId) as Record<string, unknown>[]
        return rows.map(mapReview)
    })
  )

export const deleteReview = (id: string): Effect.Effect<boolean, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('delete review', () => {
        const result = db.prepare('DELETE FROM reviews WHERE id = ?').run(id)
        return result.changes > 0
    })
  )

export const deleteReviewsByPlace = (placeId: string): Effect.Effect<number, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('delete reviews', () => {
        const result = db.prepare('DELETE FROM reviews WHERE place_id = ?').run(placeId)
        return result.changes
    })
  )

function mapReview(row: Record<string, unknown>): Review {
  return {
    id: row.id as string,
    placeId: row.place_id as string,
    rating: row.rating as number,
    text: row.text as string,
    relativeDate: row.relative_date as string | null,
  }
}
