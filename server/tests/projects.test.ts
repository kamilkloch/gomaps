import { Effect } from 'effect'
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import request from 'supertest'
import type { ScrapeRun } from '../src/db/types.js'
import type { ScrapeProgress, StartScrapeConfig } from '../src/scraper/engine.js'

const dbPath = join(tmpdir(), `gomaps-test-${randomUUID()}.db`)

// Set DB_PATH before importing app so the singleton uses the test DB
process.env.DB_PATH = dbPath

const { getScrapeRun, updateScrapeRun, closeDatabase } = await import('../src/db/index.js')
const { appRuntime } = await import('../src/runtime.js')
const {
  resetScrapeRouteStateForTests,
  setScrapeExecutorForTests,
} = await import('../src/routes/scrape.js')
const { app } = await import('../src/index.js')

afterAll(() => {
  closeDatabase()
  try { unlinkSync(dbPath) } catch { /* ignore */ }
})

describe('GET /health', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })
})

describe('project CRUD API', () => {
  let projectId: string

  it('POST /api/projects creates a project', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'Sardinia 2026' })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Sardinia 2026')
    expect(res.body.id).toBeDefined()
    expect(res.body.createdAt).toBeDefined()
    expect(res.body.bounds).toBeNull()
    projectId = res.body.id
  })

  it('POST /api/projects with bounds', async () => {
    const bounds = JSON.stringify({ sw: [39.0, 8.0], ne: [41.0, 10.0] })
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'With Bounds', bounds })
    expect(res.status).toBe(201)
    expect(res.body.bounds).toBe(bounds)
  })

  it('POST /api/projects without name returns 400', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('name is required')
  })

  it('GET /api/projects returns list', async () => {
    const res = await request(app).get('/api/projects')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThanOrEqual(2)
  })

  it('GET /api/projects/:id returns single project', async () => {
    const res = await request(app).get(`/api/projects/${projectId}`)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(projectId)
    expect(res.body.name).toBe('Sardinia 2026')
  })

  it('GET /api/projects/:id returns 404 for unknown id', async () => {
    const res = await request(app).get(`/api/projects/${randomUUID()}`)
    expect(res.status).toBe(404)
  })

  it('PUT /api/projects/:id updates a project', async () => {
    const bounds = JSON.stringify({ sw: [40.0, 9.0], ne: [41.0, 10.0] })
    const res = await request(app)
      .put(`/api/projects/${projectId}`)
      .send({ name: 'Updated Name', bounds })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Updated Name')
    expect(res.body.bounds).toBe(bounds)
  })

  it('PUT /api/projects/:id returns 404 for unknown id', async () => {
    const res = await request(app)
      .put(`/api/projects/${randomUUID()}`)
      .send({ name: 'Ghost' })
    expect(res.status).toBe(404)
  })

  it('DELETE /api/projects/:id deletes a project', async () => {
    const res = await request(app).delete(`/api/projects/${projectId}`)
    expect(res.status).toBe(204)

    const getRes = await request(app).get(`/api/projects/${projectId}`)
    expect(getRes.status).toBe(404)
  })

  it('DELETE /api/projects/:id returns 404 for unknown id', async () => {
    const res = await request(app).delete(`/api/projects/${randomUUID()}`)
    expect(res.status).toBe(404)
  })
})

describe('scrape API', () => {
  beforeEach(() => {
    resetScrapeRouteStateForTests()
  })

  it('starts a scrape run and returns status payload', async () => {
    setScrapeExecutorForTests(createMockScrapeExecutor())

    const project = await request(app)
      .post('/api/projects')
      .send({
        name: 'Scrape Project',
        bounds: JSON.stringify({
          sw: { lat: 39.0, lng: 8.0 },
          ne: { lat: 39.1, lng: 8.1 },
        }),
      })

    const start = await request(app)
      .post('/api/scrape/start')
      .send({ projectId: project.body.id, query: 'vacation rentals' })

    expect(start.status).toBe(202)
    expect(typeof start.body.scrapeRunId).toBe('string')

    await waitForRunStatus(start.body.scrapeRunId, 'completed')

    const status = await request(app).get(`/api/scrape/${start.body.scrapeRunId}`)
    expect(status.status).toBe(200)
    expect(status.body.status).toBe('completed')
    expect(status.body.tilesCompleted).toBe(2)
    expect(status.body.placesFound).toBe(6)
    expect(status.body.placesUnique).toBe(4)
    expect(status.body.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('pauses and resumes a run', async () => {
    setScrapeExecutorForTests(createMockScrapeExecutor({ delayMs: 40 }))

    const project = await request(app)
      .post('/api/projects')
      .send({
        name: 'Pause Project',
        bounds: JSON.stringify({
          sw: { lat: 40.0, lng: 9.0 },
          ne: { lat: 40.1, lng: 9.1 },
        }),
      })

    const start = await request(app)
      .post('/api/scrape/start')
      .send({ projectId: project.body.id, query: 'family hotels' })
    const runId = start.body.scrapeRunId as string

    const pause = await request(app).post(`/api/scrape/${runId}/pause`)
    expect(pause.status).toBe(202)
    expect(pause.body.status).toBe('pausing')

    await waitForRunStatus(runId, 'paused')

    const resume = await request(app).post(`/api/scrape/${runId}/resume`)
    expect(resume.status).toBe(200)
    expect(resume.body.status).toBe('running')

    await waitForRunStatus(runId, 'completed')
    const status = await request(app).get(`/api/scrape/${runId}`)
    expect(status.body.status).toBe('completed')
  })

  it('streams progress payload over SSE', async () => {
    setScrapeExecutorForTests(createMockScrapeExecutor())

    const project = await request(app)
      .post('/api/projects')
      .send({
        name: 'SSE Project',
        bounds: JSON.stringify({
          sw: { lat: 41.0, lng: 10.0 },
          ne: { lat: 41.1, lng: 10.1 },
        }),
      })

    const start = await request(app)
      .post('/api/scrape/start')
      .send({ projectId: project.body.id, query: 'apartments' })

    await waitForRunStatus(start.body.scrapeRunId, 'completed')

    const progressEvent = await readFirstSseEvent(start.body.scrapeRunId)
    expect(progressEvent.scrapeRunId).toBe(start.body.scrapeRunId)
    expect(progressEvent.status).toBe('completed')
    expect(progressEvent.tilesCompleted).toBeGreaterThanOrEqual(0)
    expect(progressEvent.tilesTotal).toBeGreaterThanOrEqual(progressEvent.tilesCompleted)
    expect(progressEvent.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('lists runs for a project via query param', async () => {
    setScrapeExecutorForTests(createMockScrapeExecutor())

    const project = await request(app)
      .post('/api/projects')
      .send({
        name: 'Runs Project',
        bounds: JSON.stringify({
          sw: { lat: 39.5, lng: 8.5 },
          ne: { lat: 39.8, lng: 8.9 },
        }),
      })

    const start = await request(app)
      .post('/api/scrape/start')
      .send({ projectId: project.body.id, query: 'villa with pool' })
    await waitForRunStatus(start.body.scrapeRunId, 'completed')

    const list = await request(app).get(`/api/scrape?projectId=${project.body.id}`)
    expect(list.status).toBe(200)
    expect(Array.isArray(list.body)).toBe(true)
    expect(list.body[0].id).toBe(start.body.scrapeRunId)
    expect(list.body[0].projectId).toBe(project.body.id)
    expect(list.body[0].query).toBe('villa with pool')
  })

  it('returns tile snapshots for a run', async () => {
    setScrapeExecutorForTests(createMockScrapeExecutor())

    const project = await request(app)
      .post('/api/projects')
      .send({
        name: 'Tiles Project',
        bounds: JSON.stringify({
          sw: { lat: 39.5, lng: 8.5 },
          ne: { lat: 39.8, lng: 8.9 },
        }),
      })

    const start = await request(app)
      .post('/api/scrape/start')
      .send({ projectId: project.body.id, query: 'seaside resort' })

    await waitForRunStatus(start.body.scrapeRunId, 'completed')

    const tiles = await request(app).get(`/api/scrape/${start.body.scrapeRunId}/tiles`)
    expect(tiles.status).toBe(200)
    expect(Array.isArray(tiles.body)).toBe(true)
  })
})

describe('placeholder routers', () => {
  it('GET /api/scrape returns empty array', async () => {
    const res = await request(app).get('/api/scrape')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('GET /api/places returns empty array', async () => {
    const res = await request(app).get('/api/places')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('GET /api/shortlists returns empty array', async () => {
    const res = await request(app).get('/api/shortlists')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

const createMockScrapeExecutor = (
  options?: {
    delayMs?: number
  }
): ((config: StartScrapeConfig) => Effect.Effect<void, never, import('../src/db/Db.js').Db>) => {
  const delayMs = options?.delayMs ?? 0
  return (config) =>
    Effect.gen(function* () {
      const runningRun = yield* updateScrapeRun(config.scrapeRunId, {
        status: 'running',
        startedAt: new Date().toISOString(),
        tilesTotal: 2,
      })
      config.onProgress?.(toProgressPayload(runningRun))

      if (delayMs > 0) {
        yield* Effect.tryPromise({
          try: () => new Promise<void>((resolve) => setTimeout(resolve, delayMs)),
          catch: () => new Error('delay failed'),
        })
      }

      if (config.shouldPause?.()) {
        const pausedRun = yield* updateScrapeRun(config.scrapeRunId, {
          status: 'paused',
          completedAt: null,
        })
        config.onProgress?.(toProgressPayload(pausedRun))
        return
      }

      const completedRun = yield* updateScrapeRun(config.scrapeRunId, {
        status: 'completed',
        tilesCompleted: 2,
        tilesSubdivided: 1,
        placesFound: 6,
        placesUnique: 4,
        completedAt: new Date().toISOString(),
      })
      config.onProgress?.(toProgressPayload(completedRun))
    })
}

const toProgressPayload = (run: ScrapeRun): ScrapeProgress => {
  const startedAt = Date.parse(run.startedAt ?? '')
  const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0

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

const waitForRunStatus = async (
  runId: string,
  expectedStatus: ScrapeRun['status']
): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const run = await getScrapeRunFromDb(runId)
    if (run.status === expectedStatus) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  throw new Error(`Timed out waiting for status ${expectedStatus}`)
}

const getScrapeRunFromDb = (runId: string): Promise<ScrapeRun> =>
  appRuntime.runPromise(getScrapeRun(runId))

const readFirstSseEvent = async (runId: string): Promise<ScrapeProgress> => {
  const response = await request(app)
    .get(`/api/scrape/${runId}/progress`)
    .buffer(true)
    .parse((res, callback) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        const dataLine = body
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line.startsWith('data: '))

        if (!dataLine) {
          callback(new Error('No SSE data event found'))
          return
        }

        try {
          callback(null, JSON.parse(dataLine.slice(6)))
        } catch (error) {
          callback(error as Error)
        }
      })
      res.on('error', callback)
    })

  return response.body as ScrapeProgress
}
