import { Effect } from 'effect'
import { Db } from './Db.js'
import { tryDb } from './effect-helpers.js'
import type { Place } from './types.js'
import { DbError, NotFoundError } from '../errors.js'

export interface CreatePlaceInput {
  id: string
  googleMapsUri: string
  googleMapsPhotosUri?: string | null
  name: string
  category?: string | null
  rating?: number | null
  reviewCount?: number | null
  priceLevel?: string | null
  phone?: string | null
  website?: string | null
  websiteType?: 'direct' | 'ota' | 'social' | 'unknown'
  address?: string | null
  lat: number
  lng: number
  photoUrls?: string[]
  openingHours?: string | null
  amenities?: string[]
}

export const createPlace = (input: CreatePlaceInput): Effect.Effect<Place, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('create place', () => {
        db.prepare(`
          INSERT INTO places (id, google_maps_uri, google_maps_photos_uri, name, category, rating, review_count, price_level, phone, website, website_type, address, lat, lng, photo_urls, opening_hours, amenities)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          input.id,
          input.googleMapsUri,
          input.googleMapsPhotosUri ?? null,
          input.name,
          input.category ?? null,
          input.rating ?? null,
          input.reviewCount ?? null,
          input.priceLevel ?? null,
          input.phone ?? null,
          input.website ?? null,
          input.websiteType ?? 'unknown',
          input.address ?? null,
          input.lat,
          input.lng,
          JSON.stringify(input.photoUrls ?? []),
          input.openingHours ?? null,
          JSON.stringify(input.amenities ?? [])
        )
        const row = db.prepare('SELECT * FROM places WHERE id = ?').get(input.id) as Record<string, unknown>
        return mapPlace(row)
    })
  )

export const getPlace = (id: string): Effect.Effect<Place, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db
    const row = yield* tryDb('get place', () =>
        db.prepare('SELECT * FROM places WHERE id = ?').get(id) as
          | Record<string, unknown>
          | undefined)
    if (!row) {
      return yield* Effect.fail(new NotFoundError({ entity: 'Place', id }))
    }
    return mapPlace(row)
  })

export const listPlaces = (projectId?: string): Effect.Effect<Place[], DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('list places', () => {
        if (projectId) {
          const rows = db
            .prepare(
              `SELECT DISTINCT p.* FROM places p
               INNER JOIN place_scrape_runs psr ON psr.place_id = p.id
               INNER JOIN scrape_runs sr ON sr.id = psr.scrape_run_id
               WHERE sr.project_id = ?
               ORDER BY p.name`
            )
            .all(projectId) as Record<string, unknown>[]
          return rows.map(mapPlace)
        }
        const rows = db.prepare('SELECT * FROM places ORDER BY name').all() as Record<string, unknown>[]
        return rows.map(mapPlace)
    })
  )

export const updatePlace = (
  id: string,
  updates: Partial<Omit<CreatePlaceInput, 'id'>>
): Effect.Effect<Place, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db
    const sets: string[] = []
    const values: unknown[] = []

    const fieldMap: Record<string, string> = {
      googleMapsUri: 'google_maps_uri',
      googleMapsPhotosUri: 'google_maps_photos_uri',
      name: 'name',
      category: 'category',
      rating: 'rating',
      reviewCount: 'review_count',
      priceLevel: 'price_level',
      phone: 'phone',
      website: 'website',
      websiteType: 'website_type',
      address: 'address',
      lat: 'lat',
      lng: 'lng',
      openingHours: 'opening_hours',
    }

    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in updates) {
        sets.push(`${col} = ?`)
        values.push((updates as Record<string, unknown>)[key] ?? null)
      }
    }

    if ('photoUrls' in updates) {
      sets.push('photo_urls = ?')
      values.push(JSON.stringify(updates.photoUrls ?? []))
    }
    if ('amenities' in updates) {
      sets.push('amenities = ?')
      values.push(JSON.stringify(updates.amenities ?? []))
    }

    if (sets.length === 0) return yield* getPlace(id)
    values.push(id)
    yield* tryDb('update place', () => {
        db.prepare(`UPDATE places SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    })
    return yield* getPlace(id)
  })

export const deletePlace = (id: string): Effect.Effect<boolean, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    tryDb('delete place', () => {
        const result = db.prepare('DELETE FROM places WHERE id = ?').run(id)
        return result.changes > 0
    })
  )

function mapPlace(row: Record<string, unknown>): Place {
  return {
    id: row.id as string,
    googleMapsUri: row.google_maps_uri as string,
    googleMapsPhotosUri: (row.google_maps_photos_uri as string | null | undefined) ?? null,
    name: row.name as string,
    category: row.category as string | null,
    rating: row.rating as number | null,
    reviewCount: row.review_count as number | null,
    priceLevel: row.price_level as string | null,
    phone: row.phone as string | null,
    website: row.website as string | null,
    websiteType: row.website_type as Place['websiteType'],
    address: row.address as string | null,
    lat: row.lat as number,
    lng: row.lng as number,
    photoUrls: row.photo_urls as string,
    openingHours: row.opening_hours as string | null,
    amenities: row.amenities as string,
    scrapedAt: row.scraped_at as string,
  }
}
