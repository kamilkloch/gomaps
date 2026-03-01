import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { Db } from './Db.js'
import type { Project, ProjectSummary, ScrapeRun } from './types.js'
import { DbError, NotFoundError } from '../errors.js'

export const createProject = (name: string, bounds?: string): Effect.Effect<Project, DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    Effect.try({
      try: () => {
        const id = randomUUID()
        db.prepare('INSERT INTO projects (id, name, bounds) VALUES (?, ?, ?)').run(id, name, bounds ?? null)
        const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown>
        return mapProject(row)
      },
      catch: (e) => new DbError({ message: `Failed to create project: ${String(e)}`, cause: e }),
    })
  )

export const getProject = (id: string): Effect.Effect<Project, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db
    const row = yield* Effect.try({
      try: () =>
        db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
          | Record<string, unknown>
          | undefined,
      catch: (e) => new DbError({ message: `Failed to get project: ${String(e)}`, cause: e }),
    })
    if (!row) {
      return yield* Effect.fail(new NotFoundError({ entity: 'Project', id }))
    }
    return mapProject(row)
  })

export const listProjects = (): Effect.Effect<ProjectSummary[], DbError, Db> =>
  Effect.flatMap(Db, ({ db }) =>
    Effect.try({
      try: () => {
        const projectRows = db
          .prepare('SELECT * FROM projects ORDER BY created_at DESC, rowid DESC')
          .all() as Record<string, unknown>[]

        const runRows = db
          .prepare(
            `SELECT id, project_id, status, started_at, completed_at
             FROM scrape_runs
             ORDER BY COALESCE(started_at, completed_at) DESC, rowid DESC`
          )
          .all() as Array<{
            id: string
            project_id: string
            status: ScrapeRun['status']
            started_at: string | null
            completed_at: string | null
          }>

        const placeAggregateRows = db
          .prepare(
            `SELECT
               sr.project_id AS project_id,
               COUNT(DISTINCT psr.place_id) AS places_count,
               MAX(p.scraped_at) AS last_scraped_at
             FROM scrape_runs sr
             LEFT JOIN place_scrape_runs psr ON psr.scrape_run_id = sr.id
             LEFT JOIN places p ON p.id = psr.place_id
             GROUP BY sr.project_id`
          )
          .all() as Array<{
            project_id: string
            places_count: number
            last_scraped_at: string | null
          }>

        const runsByProject = new Map<string, typeof runRows>()
        for (const run of runRows) {
          const runs = runsByProject.get(run.project_id)
          if (runs) {
            runs.push(run)
            continue
          }

          runsByProject.set(run.project_id, [run])
        }

        const placeAggregatesByProject = new Map(
          placeAggregateRows.map((row) => [
            row.project_id,
            {
              placesCount: row.places_count,
              lastScrapedAt: row.last_scraped_at,
            },
          ])
        )

        return projectRows.map((row) => {
          const project = mapProject(row)
          const projectRuns = runsByProject.get(project.id) ?? []
          const activeRun = projectRuns.find((run) => run.status === 'running' || run.status === 'pending')
          const pausedRun = projectRuns.find((run) => run.status === 'paused')
          const latestTerminalRun = projectRuns.find((run) => run.status === 'failed' || run.status === 'completed')
          const placeAggregate = placeAggregatesByProject.get(project.id)

          return {
            ...project,
            status: deriveProjectStatus(activeRun, pausedRun, latestTerminalRun),
            activeRunId: activeRun?.id ?? pausedRun?.id ?? null,
            scrapeRunsCount: projectRuns.length,
            placesCount: placeAggregate?.placesCount ?? 0,
            lastScrapedAt: placeAggregate?.lastScrapedAt ?? null,
          }
        })
      },
      catch: (e) => new DbError({ message: `Failed to list projects: ${String(e)}`, cause: e }),
    })
  )

export const updateProject = (
  id: string,
  updates: { name?: string; bounds?: string }
): Effect.Effect<Project, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db
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
        db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values)
      },
      catch: (e) => new DbError({ message: `Failed to update project: ${String(e)}`, cause: e }),
    })
    return yield* getProject(id)
  })

export const deleteProject = (id: string): Effect.Effect<void, DbError | NotFoundError, Db> =>
  Effect.gen(function* () {
    const { db } = yield* Db
    const result = yield* Effect.try({
      try: () => db.prepare('DELETE FROM projects WHERE id = ?').run(id),
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

const deriveProjectStatus = (
  activeRun: { status: ScrapeRun['status'] } | undefined,
  pausedRun: { status: ScrapeRun['status'] } | undefined,
  latestTerminalRun: { status: ScrapeRun['status'] } | undefined,
): ProjectSummary['status'] => {
  if (activeRun) {
    return 'running'
  }

  if (pausedRun) {
    return 'paused'
  }

  if (latestTerminalRun?.status === 'failed') {
    return 'failed'
  }

  if (latestTerminalRun?.status === 'completed') {
    return 'complete'
  }

  return 'draft'
}
