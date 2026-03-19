import { Router } from 'express'
import { Effect, Schema } from 'effect'
import type { Db } from '../db/Db.js'
import {
  createScrapeRun,
  getProject,
  getProjectAggregateCoverage,
  getScrapeRun,
  listPlaces,
  listScrapeRuns,
  listTiles,
  updateProject,
  updateScrapeRun,
} from '../db/index.js'
import { NotFoundError, ValidationError } from '../errors.js'
import {
  startRescrape,
  startScrape,
  type ScrapeProgress,
  type StartRescrapeConfig,
  type StartScrapeConfig,
} from '../scraper/engine.js'
import type { Bounds } from '../scraper/tiling.js'
import { appRuntime } from '../runtime.js'

export const scrapeRouter = Router()

const StartScrapeBody = Schema.Struct({
  projectId: Schema.String,
  query: Schema.String,
  bounds: Schema.optional(Schema.String),
  delayMs: Schema.optional(Schema.Number),
})

const StartRescrapeBody = Schema.Struct({
  projectId: Schema.String,
  delayMs: Schema.optional(Schema.Number),
})

interface RunState {
  pauseRequested: boolean
  task?: Promise<void>
}

type ScrapeExecutor = (config: StartScrapeConfig) => Effect.Effect<void, unknown, Db>
type RescrapeExecutor = (config: StartRescrapeConfig) => Effect.Effect<void, unknown, Db>

const runStates = new Map<string, RunState>()
const progressSubscribers = new Map<string, Set<(progress: ScrapeProgress) => void>>()

let scrapeExecutor: ScrapeExecutor = startScrape
let rescrapeExecutor: RescrapeExecutor = startRescrape

scrapeRouter.get('/', async (req, res) => {
  const projectId = req.query.projectId
  if (typeof projectId !== 'string' || projectId.length === 0) {
    res.json([])
    return
  }

  await appRuntime.runPromise(
    listScrapeRuns(projectId).pipe(
      Effect.andThen((runs) => Effect.sync(() => res.json(runs))),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      )
    )
  )
})

scrapeRouter.get('/coverage', async (req, res) => {
  const projectId = req.query.projectId
  if (typeof projectId !== 'string' || projectId.length === 0) {
    res.status(400).json({ error: 'projectId is required' })
    return
  }

  await appRuntime.runPromise(
    Effect.gen(function* () {
      yield* getProject(projectId)
      const coverage = yield* getProjectAggregateCoverage(projectId)
      res.json(coverage)
    }).pipe(
      Effect.catchTag('NotFoundError', () =>
        Effect.sync(() => res.status(404).json({ error: 'Project not found' }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      )
    )
  )
})

scrapeRouter.post('/start', async (req, res) => {
  await appRuntime.runPromise(
    Effect.gen(function* () {
      const body = yield* Schema.decodeUnknown(StartScrapeBody)(req.body).pipe(
        Effect.mapError(() =>
          new ValidationError({ message: 'projectId and query are required' })
        )
      )

      const project = yield* getProject(body.projectId)
      const bounds = yield* parseProjectBounds(body.bounds ?? project.bounds)
      const normalizedBounds = JSON.stringify(bounds)
      if (project.bounds !== normalizedBounds) {
        yield* updateProject(project.id, { bounds: normalizedBounds })
      }
      const run = yield* createScrapeRun(project.id, body.query, 'discovery', normalizedBounds)

      startBackgroundScrape({
        scrapeRunId: run.id,
        query: run.query,
        bounds,
        delayMs: body.delayMs,
      })

      res.status(202).json({ scrapeRunId: run.id })
    }).pipe(
      Effect.catchTag('ValidationError', (error) =>
        Effect.sync(() => res.status(400).json({ error: error.message }))
      ),
      Effect.catchTag('NotFoundError', () =>
        Effect.sync(() => res.status(404).json({ error: 'Project not found' }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      )
    )
  )
})

scrapeRouter.post('/rescrape', async (req, res) => {
  await appRuntime.runPromise(
    Effect.gen(function* () {
      const body = yield* Schema.decodeUnknown(StartRescrapeBody)(req.body).pipe(
        Effect.mapError(() =>
          new ValidationError({ message: 'projectId is required' })
        )
      )

      const project = yield* getProject(body.projectId)
      const places = yield* listPlaces(project.id)
      const run = yield* createScrapeRun(project.id, 'Refresh Data', 'refresh')
      yield* updateScrapeRun(run.id, {
        tilesTotal: places.length,
        placesUnique: places.length,
      })

      startBackgroundRescrape({
        scrapeRunId: run.id,
        projectId: project.id,
        delayMs: body.delayMs,
      })

      res.status(202).json({ scrapeRunId: run.id })
    }).pipe(
      Effect.catchTag('ValidationError', (error) =>
        Effect.sync(() => res.status(400).json({ error: error.message }))
      ),
      Effect.catchTag('NotFoundError', () =>
        Effect.sync(() => res.status(404).json({ error: 'Project not found' }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      )
    )
  )
})

scrapeRouter.get('/:runId', async (req, res) => {
  await appRuntime.runPromise(
    getScrapeRun(req.params.runId).pipe(
      Effect.andThen((run) =>
        Effect.sync(() => res.json(toProgressPayload(run)))
      ),
      Effect.catchTag('NotFoundError', () =>
        Effect.sync(() => res.status(404).json({ error: 'Scrape run not found' }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      )
    )
  )
})

scrapeRouter.get('/:runId/tiles', async (req, res) => {
  await appRuntime.runPromise(
    listTiles(req.params.runId).pipe(
      Effect.andThen((tiles) => Effect.sync(() => res.json(tiles))),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      )
    )
  )
})

scrapeRouter.post('/:runId/pause', async (req, res) => {
  await appRuntime.runPromise(
    Effect.gen(function* () {
      const run = yield* getScrapeRun(req.params.runId)
      if (run.status !== 'running') {
        return yield* Effect.sync(() =>
          res.status(409).json({ error: 'Scrape run is not running' })
        )
      }

      const runState = getRunState(run.id)
      runState.pauseRequested = true
      res.status(202).json({ status: 'pausing' })
    }).pipe(
      Effect.catchTag('NotFoundError', () =>
        Effect.sync(() => res.status(404).json({ error: 'Scrape run not found' }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      )
    )
  )
})

scrapeRouter.post('/:runId/resume', async (req, res) => {
  await appRuntime.runPromise(
    Effect.gen(function* () {
      const run = yield* getScrapeRun(req.params.runId)
      if (run.status !== 'paused') {
        return yield* Effect.sync(() =>
          res.status(409).json({ error: 'Scrape run is not paused' })
        )
      }

      const project = run.bounds ? null : yield* getProject(run.projectId)
      const bounds = yield* parseProjectBounds(run.bounds ?? project?.bounds ?? null)
      const runState = getRunState(run.id)
      runState.pauseRequested = false

      startBackgroundScrape({
        scrapeRunId: run.id,
        query: run.query,
        bounds,
      })

      res.json({ status: 'running' })
    }).pipe(
      Effect.catchTag('ValidationError', (error) =>
        Effect.sync(() => res.status(400).json({ error: error.message }))
      ),
      Effect.catchTag('NotFoundError', (error) =>
        Effect.sync(() =>
          res.status(404).json({ error: mapNotFoundError(error) })
        )
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      )
    )
  )
})

scrapeRouter.get('/:runId/progress', async (req, res) => {
  await appRuntime.runPromise(
    getScrapeRun(req.params.runId).pipe(
      Effect.andThen((run) =>
        Effect.sync(() => {
          res.setHeader('Content-Type', 'text/event-stream')
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('Connection', 'keep-alive')
          res.flushHeaders()

          const runId = run.id
          let cleanedUp = false
          const keepAlive = setInterval(() => {
            res.write(': keep-alive\n\n')
          }, 15_000)

          const cleanup = () => {
            if (cleanedUp) {
              return
            }

            cleanedUp = true
            clearInterval(keepAlive)
            unsubscribe(runId, onProgress)
          }

          const sendProgress = (progress: ScrapeProgress): void => {
            res.write(`data: ${JSON.stringify(progress)}\n\n`)
            if (isTerminalStatus(progress.status)) {
              cleanup()
              res.end()
            }
          }

          const onProgress = (progress: ScrapeProgress): void => {
            sendProgress(progress)
          }

          subscribe(runId, onProgress)
          sendProgress(toProgressPayload(run))

          req.on('close', () => {
            cleanup()
          })
        })
      ),
      Effect.catchTag('NotFoundError', () =>
        Effect.sync(() => res.status(404).json({ error: 'Scrape run not found' }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      )
    )
  )
})

const parseProjectBounds = (
  rawBounds: string | null
): Effect.Effect<Bounds, ValidationError> =>
  Effect.try({
    try: () => {
      if (!rawBounds) {
        throw new Error('Project bounds are required before starting a scrape')
      }

      const bounds = JSON.parse(rawBounds) as Bounds
      if (
        Number.isNaN(bounds.sw.lat) ||
        Number.isNaN(bounds.sw.lng) ||
        Number.isNaN(bounds.ne.lat) ||
        Number.isNaN(bounds.ne.lng) ||
        bounds.sw.lat >= bounds.ne.lat ||
        bounds.sw.lng >= bounds.ne.lng
      ) {
        throw new Error('Project bounds are invalid')
      }

      return bounds
    },
    catch: (cause) =>
      new ValidationError({
        message:
          cause instanceof Error
            ? cause.message
            : 'Project bounds are required before starting a scrape',
      }),
  })

const startBackgroundScrape = (config: StartScrapeConfig): void => {
  const runState = getRunState(config.scrapeRunId)
  if (runState.task) {
    return
  }

  runState.pauseRequested = false
  const backgroundTask = appRuntime
    .runPromise(
      scrapeExecutor({
        ...config,
        shouldPause: () => runState.pauseRequested,
        onProgress: (progress) => {
          broadcastProgress(progress)
        },
      })
    )
    .catch((error) => {
      console.error('Scrape run failed', error)
    })
    .finally(() => {
      runState.task = undefined
    })

  runState.task = backgroundTask
}

const startBackgroundRescrape = (config: StartRescrapeConfig): void => {
  const runState = getRunState(config.scrapeRunId)
  if (runState.task) {
    return
  }

  runState.pauseRequested = false
  const backgroundTask = appRuntime
    .runPromise(
      rescrapeExecutor({
        ...config,
        shouldPause: () => runState.pauseRequested,
        onProgress: (progress) => {
          broadcastProgress(progress)
        },
      })
    )
    .catch((error) => {
      console.error('Re-scrape run failed', error)
    })
    .finally(() => {
      runState.task = undefined
    })

  runState.task = backgroundTask
}

const getRunState = (runId: string): RunState => {
  const existing = runStates.get(runId)
  if (existing) {
    return existing
  }

  const created: RunState = { pauseRequested: false }
  runStates.set(runId, created)
  return created
}

const subscribe = (runId: string, subscriber: (progress: ScrapeProgress) => void): void => {
  const listeners = progressSubscribers.get(runId)
  if (listeners) {
    listeners.add(subscriber)
    return
  }

  progressSubscribers.set(runId, new Set([subscriber]))
}

const unsubscribe = (runId: string, subscriber: (progress: ScrapeProgress) => void): void => {
  const listeners = progressSubscribers.get(runId)
  if (!listeners) {
    return
  }

  listeners.delete(subscriber)
  if (listeners.size === 0) {
    progressSubscribers.delete(runId)
  }
}

const broadcastProgress = (progress: ScrapeProgress): void => {
  const listeners = progressSubscribers.get(progress.scrapeRunId)
  if (!listeners) {
    return
  }

  for (const listener of listeners) {
    listener(progress)
  }
}

const toProgressPayload = (
  run: {
    id: string
    status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
    tilesTotal: number
    tilesCompleted: number
    tilesSubdivided: number
    placesFound: number
    placesUnique: number
    startedAt: string | null
    completedAt: string | null
  }
): ScrapeProgress => {
  const parsedStartedAt = Date.parse(run.startedAt ?? '')
  if (!Number.isFinite(parsedStartedAt)) {
    return {
      scrapeRunId: run.id,
      status: run.status,
      tilesTotal: run.tilesTotal,
      tilesCompleted: run.tilesCompleted,
      tilesSubdivided: run.tilesSubdivided,
      placesFound: run.placesFound,
      placesUnique: run.placesUnique,
      elapsedMs: 0,
    }
  }

  // For terminal runs, freeze elapsed time at completedAt instead of
  // letting it grow with Date.now().
  const endMs = isTerminalStatus(run.status) && run.completedAt
    ? Date.parse(run.completedAt)
    : Date.now()
  const elapsedMs = Math.max(0, (Number.isFinite(endMs) ? endMs : Date.now()) - parsedStartedAt)

  return {
    scrapeRunId: run.id,
    status: run.status,
    tilesTotal: run.tilesTotal,
    tilesCompleted: run.tilesCompleted,
    tilesSubdivided: run.tilesSubdivided,
    placesFound: run.placesFound,
    placesUnique: run.placesUnique,
    elapsedMs,
  }
}

const isTerminalStatus = (status: ScrapeProgress['status']): boolean =>
  status === 'completed' || status === 'failed' || status === 'paused'

const mapNotFoundError = (error: NotFoundError): string =>
  error.entity === 'Project' ? 'Project not found' : 'Scrape run not found'

export const setScrapeExecutorForTests = (executor?: ScrapeExecutor): void => {
  scrapeExecutor = executor ?? startScrape
}

export const setRescrapeExecutorForTests = (executor?: RescrapeExecutor): void => {
  rescrapeExecutor = executor ?? startRescrape
}

export const resetScrapeRouteStateForTests = (): void => {
  runStates.clear()
  progressSubscribers.clear()
  scrapeExecutor = startScrape
  rescrapeExecutor = startRescrape
}
