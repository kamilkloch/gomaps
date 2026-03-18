import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import Database from 'better-sqlite3'
import { createDatabase } from '../src/db/schema.js'

function createTestDb() {
  const dbPath = join(tmpdir(), `gomaps-test-${randomUUID()}.db`)
  const db = createDatabase(dbPath)
  return { db, dbPath }
}

describe('schema', () => {
  let db: Database.Database
  let dbPath: string

  beforeEach(() => {
    const result = createTestDb()
    db = result.db
    dbPath = result.dbPath
  })

  afterEach(() => {
    db.close()
    try { unlinkSync(dbPath) } catch { /* ignore */ }
  })

  it('creates all tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const tableNames = tables.map((t) => t.name).filter((n) => !n.startsWith('sqlite_'))
    expect(tableNames).toContain('projects')
    expect(tableNames).toContain('scrape_runs')
    expect(tableNames).toContain('tiles')
    expect(tableNames).toContain('places')
    expect(tableNames).toContain('reviews')
    expect(tableNames).toContain('place_scrape_runs')
    expect(tableNames).toContain('shortlists')
    expect(tableNames).toContain('shortlist_entries')
  })

  it('adds bounds column to scrape_runs', () => {
    const columns = db
      .prepare('PRAGMA table_info(scrape_runs)')
      .all() as Array<{ name: string }>
    const columnNames = columns.map((column) => column.name)
    expect(columnNames).toContain('bounds')
  })

  it('has WAL journal mode', () => {
    const result = db.pragma('journal_mode') as { journal_mode: string }[]
    expect(result[0].journal_mode).toBe('wal')
  })

  it('has foreign keys enabled', () => {
    const result = db.pragma('foreign_keys') as { foreign_keys: number }[]
    expect(result[0].foreign_keys).toBe(1)
  })

  it('migrates legacy places.google_url schema to places.google_maps_uri', () => {
    db.exec('DROP TABLE places')
    db.exec(`
      CREATE TABLE places (
        id TEXT PRIMARY KEY,
        google_url TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT,
        rating REAL,
        review_count INTEGER,
        price_level TEXT,
        phone TEXT,
        website TEXT,
        website_type TEXT NOT NULL DEFAULT 'unknown',
        address TEXT,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        photo_urls TEXT NOT NULL DEFAULT '[]',
        opening_hours TEXT,
        amenities TEXT NOT NULL DEFAULT '[]',
        scraped_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    db.prepare(`
      INSERT INTO places (
        id,
        google_url,
        name,
        lat,
        lng
      )
      VALUES (?, ?, ?, ?, ?)
    `).run('legacy-place', 'https://maps.google.com/?cid=legacy', 'Legacy Place', 39.2, 9.1)
    db.close()
    db = createDatabase(dbPath)

    const columns = db
      .prepare('PRAGMA table_info(places)')
      .all() as Array<{ name: string }>
    const columnNames = columns.map((column) => column.name)
    expect(columnNames).toContain('google_maps_uri')
    expect(columnNames).not.toContain('google_url')

    const legacyRow = db.prepare('SELECT * FROM places WHERE id = ?').get('legacy-place') as Record<string, unknown>
    expect(legacyRow.google_maps_uri).toBe('https://maps.google.com/?cid=legacy')

    const placeScrapeRunForeignKeys = db
      .prepare('PRAGMA foreign_key_list(place_scrape_runs)')
      .all() as Array<{ table: string }>
    expect(placeScrapeRunForeignKeys.some((foreignKey) => foreignKey.table === 'places')).toBe(true)

    db.prepare(`
      INSERT INTO places (
        id,
        google_maps_uri,
        name,
        lat,
        lng
      )
      VALUES (?, ?, ?, ?, ?)
    `).run('new-place', 'https://maps.google.com/?cid=new', 'New Place', 39.3, 9.2)

    const insertedRow = db.prepare('SELECT * FROM places WHERE id = ?').get('new-place') as Record<string, unknown>
    expect(insertedRow.google_maps_uri).toBe('https://maps.google.com/?cid=new')
  })

  it('migrates legacy scrape_runs schema to add bounds', () => {
    db.close()
    try { unlinkSync(dbPath) } catch { /* ignore */ }

    const legacyDb = new Database(dbPath)
    legacyDb.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        bounds TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE scrape_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        query TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'discovery',
        status TEXT NOT NULL DEFAULT 'pending',
        tiles_total INTEGER NOT NULL DEFAULT 0,
        tiles_completed INTEGER NOT NULL DEFAULT 0,
        tiles_subdivided INTEGER NOT NULL DEFAULT 0,
        places_found INTEGER NOT NULL DEFAULT 0,
        places_unique INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        completed_at TEXT
      );
    `)
    legacyDb.close()

    db = createDatabase(dbPath)

    const columns = db
      .prepare('PRAGMA table_info(scrape_runs)')
      .all() as Array<{ name: string }>
    const columnNames = columns.map((column) => column.name)
    expect(columnNames).toContain('bounds')
  })
})

describe('project CRUD', () => {
  let db: Database.Database
  let dbPath: string

  beforeEach(() => {
    const result = createTestDb()
    db = result.db
    dbPath = result.dbPath
  })

  afterEach(() => {
    db.close()
    try { unlinkSync(dbPath) } catch { /* ignore */ }
  })

  it('inserts and reads a project', () => {
    const id = randomUUID()
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, 'Test Project')

    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown>
    expect(row.id).toBe(id)
    expect(row.name).toBe('Test Project')
    expect(row.bounds).toBeNull()
    expect(row.created_at).toBeDefined()
  })

  it('updates a project', () => {
    const id = randomUUID()
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, 'Original')

    const bounds = JSON.stringify({ sw: [39.0, 8.0], ne: [41.0, 10.0] })
    db.prepare('UPDATE projects SET name = ?, bounds = ? WHERE id = ?').run('Updated', bounds, id)

    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown>
    expect(row.name).toBe('Updated')
    expect(row.bounds).toBe(bounds)
  })

  it('deletes a project', () => {
    const id = randomUUID()
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, 'To Delete')

    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    expect(result.changes).toBe(1)

    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
    expect(row).toBeUndefined()
  })

  it('lists multiple projects', () => {
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(randomUUID(), 'Project A')
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(randomUUID(), 'Project B')

    const rows = db.prepare('SELECT * FROM projects').all()
    expect(rows.length).toBe(2)
  })
})

describe('place CRUD', () => {
  let db: Database.Database
  let dbPath: string

  beforeEach(() => {
    const result = createTestDb()
    db = result.db
    dbPath = result.dbPath
  })

  afterEach(() => {
    db.close()
    try { unlinkSync(dbPath) } catch { /* ignore */ }
  })

  it('inserts and reads a place', () => {
    const id = 'place-001'
    db.prepare(`
      INSERT INTO places (id, google_maps_uri, name, lat, lng)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, 'https://maps.google.com/place/test', 'Hotel Sardinia', 39.2, 9.1)

    const row = db.prepare('SELECT * FROM places WHERE id = ?').get(id) as Record<string, unknown>
    expect(row.id).toBe(id)
    expect(row.name).toBe('Hotel Sardinia')
    expect(row.lat).toBe(39.2)
    expect(row.lng).toBe(9.1)
    expect(row.google_maps_uri).toBe('https://maps.google.com/place/test')
    expect(row.website_type).toBe('unknown')
    expect(row.photo_urls).toBe('[]')
    expect(row.amenities).toBe('[]')
  })

  it('inserts a place with all fields', () => {
    const id = 'place-002'
    const photoUrls = JSON.stringify(['https://photo1.jpg', 'https://photo2.jpg'])
    const amenities = JSON.stringify(['pool', 'wifi', 'parking'])

    db.prepare(`
      INSERT INTO places (id, google_maps_uri, name, category, rating, review_count, price_level, phone, website, website_type, address, lat, lng, photo_urls, opening_hours, amenities)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, 'https://maps.google.com/place/full', 'Grand Hotel',
      'Hotel', 4.5, 200, '$$$', '+39 123 456', 'https://grandhotel.it',
      'direct', '123 Via Roma', 39.5, 9.3, photoUrls, 'Mon-Sun 8am-10pm', amenities
    )

    const row = db.prepare('SELECT * FROM places WHERE id = ?').get(id) as Record<string, unknown>
    expect(row.category).toBe('Hotel')
    expect(row.rating).toBe(4.5)
    expect(row.review_count).toBe(200)
    expect(row.price_level).toBe('$$$')
    expect(row.phone).toBe('+39 123 456')
    expect(row.website).toBe('https://grandhotel.it')
    expect(row.website_type).toBe('direct')
    expect(row.photo_urls).toBe(photoUrls)
    expect(row.amenities).toBe(amenities)
  })

  it('enforces unique google_maps_uri', () => {
    const url = 'https://maps.google.com/place/unique'
    db.prepare('INSERT INTO places (id, google_maps_uri, name, lat, lng) VALUES (?, ?, ?, ?, ?)').run(
      'p1', url, 'Place 1', 39.0, 9.0
    )
    expect(() => {
      db.prepare('INSERT INTO places (id, google_maps_uri, name, lat, lng) VALUES (?, ?, ?, ?, ?)').run(
        'p2', url, 'Place 2', 39.1, 9.1
      )
    }).toThrow()
  })

  it('updates a place', () => {
    const id = 'place-upd'
    db.prepare('INSERT INTO places (id, google_maps_uri, name, lat, lng) VALUES (?, ?, ?, ?, ?)').run(
      id, 'https://maps.google.com/place/upd', 'Old Name', 39.0, 9.0
    )

    db.prepare('UPDATE places SET name = ?, rating = ? WHERE id = ?').run('New Name', 4.2, id)

    const row = db.prepare('SELECT * FROM places WHERE id = ?').get(id) as Record<string, unknown>
    expect(row.name).toBe('New Name')
    expect(row.rating).toBe(4.2)
  })

  it('deletes a place', () => {
    const id = 'place-del'
    db.prepare('INSERT INTO places (id, google_maps_uri, name, lat, lng) VALUES (?, ?, ?, ?, ?)').run(
      id, 'https://maps.google.com/place/del', 'To Delete', 39.0, 9.0
    )

    const result = db.prepare('DELETE FROM places WHERE id = ?').run(id)
    expect(result.changes).toBe(1)

    const row = db.prepare('SELECT * FROM places WHERE id = ?').get(id)
    expect(row).toBeUndefined()
  })

  it('cascades review delete when place is deleted', () => {
    const placeId = 'place-cascade'
    db.prepare('INSERT INTO places (id, google_maps_uri, name, lat, lng) VALUES (?, ?, ?, ?, ?)').run(
      placeId, 'https://maps.google.com/place/cascade', 'Cascade Test', 39.0, 9.0
    )
    db.prepare('INSERT INTO reviews (id, place_id, rating, text) VALUES (?, ?, ?, ?)').run(
      'rev-1', placeId, 5, 'Great place!'
    )

    db.prepare('DELETE FROM places WHERE id = ?').run(placeId)

    const reviews = db.prepare('SELECT * FROM reviews WHERE place_id = ?').all(placeId)
    expect(reviews.length).toBe(0)
  })
})
