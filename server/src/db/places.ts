import { getDatabase } from './schema.js'
import type { Place } from './types.js'

export interface CreatePlaceInput {
  id: string
  googleUrl: string
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

export function createPlace(input: CreatePlaceInput): Place {
  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT INTO places (id, google_url, name, category, rating, review_count, price_level, phone, website, website_type, address, lat, lng, photo_urls, opening_hours, amenities)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    input.id,
    input.googleUrl,
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
  return getPlace(input.id)!
}

export function getPlace(id: string): Place | undefined {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM places WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!row) return undefined
  return mapPlace(row)
}

export function listPlaces(projectId?: string): Place[] {
  const db = getDatabase()
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
}

export function updatePlace(
  id: string,
  updates: Partial<Omit<CreatePlaceInput, 'id'>>
): Place | undefined {
  const db = getDatabase()
  const sets: string[] = []
  const values: unknown[] = []

  const fieldMap: Record<string, string> = {
    googleUrl: 'google_url',
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

  if (sets.length === 0) return getPlace(id)
  values.push(id)
  db.prepare(`UPDATE places SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return getPlace(id)
}

export function deletePlace(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM places WHERE id = ?').run(id)
  return result.changes > 0
}

function mapPlace(row: Record<string, unknown>): Place {
  return {
    id: row.id as string,
    googleUrl: row.google_url as string,
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
