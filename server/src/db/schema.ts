import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const PLACES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  google_maps_uri TEXT NOT NULL UNIQUE,
  google_maps_photos_uri TEXT,
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
`

const REVIEWS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  text TEXT NOT NULL,
  relative_date TEXT
);
`

const PLACE_SCRAPE_RUNS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS place_scrape_runs (
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  scrape_run_id TEXT NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  PRIMARY KEY (place_id, scrape_run_id)
);
`

const SHORTLIST_ENTRIES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS shortlist_entries (
  shortlist_id TEXT NOT NULL REFERENCES shortlists(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (shortlist_id, place_id)
);
`

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bounds TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scrape_runs (
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

CREATE TABLE IF NOT EXISTS tiles (
  id TEXT PRIMARY KEY,
  scrape_run_id TEXT NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  bounds TEXT NOT NULL,
  zoom_level INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  result_count INTEGER NOT NULL DEFAULT 0,
  parent_tile_id TEXT REFERENCES tiles(id)
);

${PLACES_TABLE_SQL}

${REVIEWS_TABLE_SQL}

${PLACE_SCRAPE_RUNS_TABLE_SQL}

CREATE TABLE IF NOT EXISTS shortlists (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

${SHORTLIST_ENTRIES_TABLE_SQL}
`

export function createDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  migrateLegacyPlacesTable(db)
  migratePlacesPhotosUriColumn(db)
  migrateScrapeRunKindColumn(db)
  return db
}

const migrateLegacyPlacesTable = (db: Database.Database): void => {
  const tableInfo = db
    .prepare('PRAGMA table_info(places)')
    .all() as Array<{ name: string }>

  const columnNames = new Set(tableInfo.map((column) => column.name))
  if (columnNames.has('google_maps_uri')) {
    return
  }

  if (!columnNames.has('google_url')) {
    return
  }

  db.exec('BEGIN')
  try {
    // Keep dependent table foreign-key declarations pointing at "places"
    // while we swap the legacy table for the modern schema.
    db.pragma('foreign_keys = OFF')
    db.pragma('legacy_alter_table = ON')

    db.exec('ALTER TABLE places RENAME TO places_legacy')
    db.exec(PLACES_TABLE_SQL)
    db.exec(`
      INSERT INTO places (
        id,
        google_maps_uri,
        google_maps_photos_uri,
        name,
        category,
        rating,
        review_count,
        price_level,
        phone,
        website,
        website_type,
        address,
        lat,
        lng,
        photo_urls,
        opening_hours,
        amenities,
        scraped_at
      )
      SELECT
        id,
        google_url,
        NULL,
        name,
        category,
        rating,
        review_count,
        price_level,
        phone,
        website,
        website_type,
        address,
        lat,
        lng,
        photo_urls,
        opening_hours,
        amenities,
        scraped_at
      FROM places_legacy
    `)

    db.exec('ALTER TABLE reviews RENAME TO reviews_legacy')
    db.exec(REVIEWS_TABLE_SQL)
    db.exec(`
      INSERT INTO reviews (id, place_id, rating, text, relative_date)
      SELECT id, place_id, rating, text, relative_date
      FROM reviews_legacy
    `)

    db.exec('ALTER TABLE place_scrape_runs RENAME TO place_scrape_runs_legacy')
    db.exec(PLACE_SCRAPE_RUNS_TABLE_SQL)
    db.exec(`
      INSERT INTO place_scrape_runs (place_id, scrape_run_id)
      SELECT place_id, scrape_run_id
      FROM place_scrape_runs_legacy
    `)

    db.exec('ALTER TABLE shortlist_entries RENAME TO shortlist_entries_legacy')
    db.exec(SHORTLIST_ENTRIES_TABLE_SQL)
    db.exec(`
      INSERT INTO shortlist_entries (shortlist_id, place_id, notes)
      SELECT shortlist_id, place_id, notes
      FROM shortlist_entries_legacy
    `)

    db.exec('DROP TABLE reviews_legacy')
    db.exec('DROP TABLE place_scrape_runs_legacy')
    db.exec('DROP TABLE shortlist_entries_legacy')
    db.exec('DROP TABLE places_legacy')

    db.pragma('legacy_alter_table = OFF')
    db.pragma('foreign_keys = ON')
    db.exec('COMMIT')
  }
  catch (error) {
    db.exec('ROLLBACK')
    db.pragma('legacy_alter_table = OFF')
    db.pragma('foreign_keys = ON')
    throw error
  }
}

const migratePlacesPhotosUriColumn = (db: Database.Database): void => {
  const tableInfo = db
    .prepare('PRAGMA table_info(places)')
    .all() as Array<{ name: string }>
  const columnNames = new Set(tableInfo.map((column) => column.name))
  if (columnNames.has('google_maps_photos_uri')) {
    return
  }

  db.exec('ALTER TABLE places ADD COLUMN google_maps_photos_uri TEXT')
}

const migrateScrapeRunKindColumn = (db: Database.Database): void => {
  const tableInfo = db
    .prepare('PRAGMA table_info(scrape_runs)')
    .all() as Array<{ name: string }>
  const columnNames = new Set(tableInfo.map((column) => column.name))
  if (columnNames.has('kind')) {
    return
  }

  db.exec("ALTER TABLE scrape_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'discovery'")
}

const DEFAULT_DB_PATH = process.env.DB_PATH ?? 'data/gomaps.db'

let _db: Database.Database | undefined

export function getDatabase(): Database.Database {
  if (!_db) {
    _db = createDatabase(DEFAULT_DB_PATH)
  }
  return _db
}

export function closeDatabase(): void {
  if (_db) {
    _db.close()
    _db = undefined
  }
}
