import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { getDatabase } from './schema.js'
import type { Project } from './types.js'
import { DbError, NotFoundError } from '../errors.js'

export const createProject = (name: string, bounds?: string): Effect.Effect<Project, DbError> =>
  Effect.try({
    try: () => {
      const db = getDatabase()
      const id = randomUUID()
      db.prepare('INSERT INTO projects (id, name, bounds) VALUES (?, ?, ?)').run(id, name, bounds ?? null)
      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown>
      return mapProject(row)
    },
    catch: (e) => new DbError({ message: `Failed to create project: ${String(e)}`, cause: e }),
  })

export const getProject = (id: string): Effect.Effect<Project, DbError | NotFoundError> =>
  Effect.gen(function* () {
    const row = yield* Effect.try({
      try: () => {
        const db = getDatabase()
        return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
          | Record<string, unknown>
          | undefined
      },
      catch: (e) => new DbError({ message: `Failed to get project: ${String(e)}`, cause: e }),
    })
    if (!row) {
      return yield* Effect.fail(new NotFoundError({ entity: 'Project', id }))
    }
    return mapProject(row)
  })

export const listProjects = (): Effect.Effect<Project[], DbError> =>
  Effect.try({
    try: () => {
      const db = getDatabase()
      const rows = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Record<string, unknown>[]
      return rows.map(mapProject)
    },
    catch: (e) => new DbError({ message: `Failed to list projects: ${String(e)}`, cause: e }),
  })

export const updateProject = (
  id: string,
  updates: { name?: string; bounds?: string }
): Effect.Effect<Project, DbError | NotFoundError> =>
  Effect.gen(function* () {
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
    if (sets.length === 0) return yield* getProject(id)
    values.push(id)
    yield* Effect.try({
      try: () => {
        const db = getDatabase()
        db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values)
      },
      catch: (e) => new DbError({ message: `Failed to update project: ${String(e)}`, cause: e }),
    })
    return yield* getProject(id)
  })

export const deleteProject = (id: string): Effect.Effect<void, DbError | NotFoundError> =>
  Effect.gen(function* () {
    const result = yield* Effect.try({
      try: () => {
        const db = getDatabase()
        return db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      },
      catch: (e) => new DbError({ message: `Failed to delete project: ${String(e)}`, cause: e }),
    })
    if (result.changes === 0) {
      return yield* Effect.fail(new NotFoundError({ entity: 'Project', id }))
    }
  })

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    bounds: row.bounds as string | null,
    createdAt: row.created_at as string,
  }
}
