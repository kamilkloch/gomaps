import { randomUUID } from 'node:crypto'
import { getDatabase } from './schema.js'
import type { Project } from './types.js'

export function createProject(name: string, bounds?: string): Project {
  const db = getDatabase()
  const id = randomUUID()
  const stmt = db.prepare(
    'INSERT INTO projects (id, name, bounds) VALUES (?, ?, ?)'
  )
  stmt.run(id, name, bounds ?? null)
  return getProject(id)!
}

export function getProject(id: string): Project | undefined {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!row) return undefined
  return mapProject(row)
}

export function listProjects(): Project[] {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Record<string, unknown>[]
  return rows.map(mapProject)
}

export function updateProject(
  id: string,
  updates: { name?: string; bounds?: string }
): Project | undefined {
  const db = getDatabase()
  const sets: string[] = []
  const values: unknown[] = []
  if (updates.name !== undefined) {
    sets.push('name = ?')
    values.push(updates.name)
  }
  if (updates.bounds !== undefined) {
    sets.push('bounds = ?')
    values.push(updates.bounds)
  }
  if (sets.length === 0) return getProject(id)
  values.push(id)
  db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(
    ...values
  )
  return getProject(id)
}

export function deleteProject(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  return result.changes > 0
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    bounds: row.bounds as string | null,
    createdAt: row.created_at as string,
  }
}
