import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

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

CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY,
  google_maps_uri TEXT NOT NULL UNIQUE,
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

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  text TEXT NOT NULL,
  relative_date TEXT
);

CREATE TABLE IF NOT EXISTS place_scrape_runs (
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  scrape_run_id TEXT NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  PRIMARY KEY (place_id, scrape_run_id)
);

CREATE TABLE IF NOT EXISTS shortlists (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shortlist_entries (
  shortlist_id TEXT NOT NULL REFERENCES shortlists(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (shortlist_id, place_id)
);
`

export function createDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  return db
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
