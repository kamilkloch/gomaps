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

// Set env flags before importing app so singletons use test settings.
process.env.DB_PATH = dbPath
process.env.E2E_TEST_MODE = '1'

const {
  addShortlistEntry,
  closeDatabase,
  createPlace,
  createProject,
  createReview,
  createScrapeRun,
  createShortlist,
  deleteReview,
  deleteReviewsByPlace,
  deleteShortlist,
  getReview,
  getScrapeRun,
  getShortlist,
  getShortlistEntry,
  linkPlaceToScrapeRun,
  listPlaceScrapeRuns,
  listReviews,
  listShortlistEntries,
  listShortlists,
  removeShortlistEntry,
  truncateAllTables,
  unlinkPlaceFromScrapeRun,
  updateScrapeRun,
  updateShortlist,
  updateShortlistEntryNotes,
} = await import('../src/db/index.js')
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

describe('project list summaries', () => {
  it('derives status precedence and aggregate metrics from persisted run/place data', async () => {
    const [draftProject, completedProject, failedProject, pausedProject, runningProject] = await Promise.all([
      request(app).post('/api/projects').send({ name: 'Draft Project' }),
      request(app).post('/api/projects').send({ name: 'Completed Project' }),
      request(app).post('/api/projects').send({ name: 'Failed Project' }),
      request(app).post('/api/projects').send({ name: 'Paused Project' }),
      request(app).post('/api/projects').send({ name: 'Running Project' }),
    ])

    expect(draftProject.status).toBe(201)
    expect(completedProject.status).toBe(201)
    expect(failedProject.status).toBe(201)
    expect(pausedProject.status).toBe(201)
    expect(runningProject.status).toBe(201)

    const completedRunId = await appRuntime.runPromise(
      Effect.gen(function* () {
        const completedRun = yield* createScrapeRun(completedProject.body.id as string, 'completed query')
        yield* updateScrapeRun(completedRun.id, {
          status: 'completed',
          tilesTotal: 3,
          tilesCompleted: 3,
          placesFound: 1,
          placesUnique: 1,
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:10:00.000Z',
        })

        yield* createPlace({
          id: 'summary-place-1',
          googleMapsUri: 'https://maps.google.com/?cid=summary-1',
          name: 'Summary Place 1',
          lat: 40.1,
          lng: 9.1,
        })
        yield* linkPlaceToScrapeRun('summary-place-1', completedRun.id)

        return completedRun.id
      })
    )

    const failedRunId = await appRuntime.runPromise(
      Effect.gen(function* () {
        const olderCompletedRun = yield* createScrapeRun(failedProject.body.id as string, 'older completed query')
        yield* updateScrapeRun(olderCompletedRun.id, {
          status: 'completed',
          startedAt: '2026-01-01T01:00:00.000Z',
          completedAt: '2026-01-01T01:05:00.000Z',
        })

        const failedRun = yield* createScrapeRun(failedProject.body.id as string, 'failed query')
        yield* updateScrapeRun(failedRun.id, {
          status: 'failed',
          startedAt: '2026-01-01T02:00:00.000Z',
          completedAt: '2026-01-01T02:07:00.000Z',
        })

        return failedRun.id
      })
    )

    const pausedRunId = await appRuntime.runPromise(
      Effect.gen(function* () {
        const pausedRun = yield* createScrapeRun(pausedProject.body.id as string, 'paused query')
        yield* updateScrapeRun(pausedRun.id, {
          status: 'paused',
          startedAt: '2026-01-01T03:00:00.000Z',
          completedAt: null,
        })

        return pausedRun.id
      })
    )

    const runningRunId = await appRuntime.runPromise(
      Effect.gen(function* () {
        const olderCompletedRun = yield* createScrapeRun(runningProject.body.id as string, 'older completed query')
        yield* updateScrapeRun(olderCompletedRun.id, {
          status: 'completed',
          startedAt: '2026-01-01T04:00:00.000Z',
          completedAt: '2026-01-01T04:06:00.000Z',
        })

        const runningRun = yield* createScrapeRun(runningProject.body.id as string, 'running query')
        yield* updateScrapeRun(runningRun.id, {
          status: 'running',
          startedAt: '2026-01-01T05:00:00.000Z',
          completedAt: null,
        })

        yield* createPlace({
          id: 'summary-place-2',
          googleMapsUri: 'https://maps.google.com/?cid=summary-2',
          name: 'Summary Place 2',
          lat: 40.2,
          lng: 9.2,
        })
        yield* linkPlaceToScrapeRun('summary-place-2', runningRun.id)

        return runningRun.id
      })
    )

    const listResponse = await request(app).get('/api/projects')
    expect(listResponse.status).toBe(200)

    const projectsByName = new Map(
      (listResponse.body as Array<Record<string, unknown>>).map((project) => [project.name as string, project])
    )

    const draftSummary = projectsByName.get('Draft Project')
    expect(draftSummary).toBeDefined()
    expect(draftSummary?.status).toBe('draft')
    expect(draftSummary?.scrapeRunsCount).toBe(0)
    expect(draftSummary?.placesCount).toBe(0)
    expect(draftSummary?.lastScrapedAt).toBeNull()
    expect(draftSummary?.activeRunId).toBeNull()

    const completedSummary = projectsByName.get('Completed Project')
    expect(completedSummary).toBeDefined()
    expect(completedSummary?.status).toBe('complete')
    expect(completedSummary?.activeRunId).toBeNull()
    expect(completedSummary?.scrapeRunsCount).toBe(1)
    expect(completedSummary?.placesCount).toBe(1)
    expect(completedSummary?.lastScrapedAt).not.toBeNull()

    const failedSummary = projectsByName.get('Failed Project')
    expect(failedSummary).toBeDefined()
    expect(failedSummary?.status).toBe('failed')
    expect(failedSummary?.activeRunId).toBeNull()
    expect(failedSummary?.scrapeRunsCount).toBe(2)
    expect(failedSummary?.placesCount).toBe(0)

    const pausedSummary = projectsByName.get('Paused Project')
    expect(pausedSummary).toBeDefined()
    expect(pausedSummary?.status).toBe('paused')
    expect(pausedSummary?.activeRunId).toBe(pausedRunId)
    expect(pausedSummary?.scrapeRunsCount).toBe(1)

    const runningSummary = projectsByName.get('Running Project')
    expect(runningSummary).toBeDefined()
    expect(runningSummary?.status).toBe('running')
    expect(runningSummary?.activeRunId).toBe(runningRunId)
    expect(runningSummary?.scrapeRunsCount).toBe(2)
    expect(runningSummary?.placesCount).toBe(1)
    expect(runningSummary?.lastScrapedAt).not.toBeNull()

    expect(completedRunId).toBeTruthy()
    expect(failedRunId).toBeTruthy()
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
  beforeEach(async () => {
    await appRuntime.runPromise(truncateAllTables())
  })

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

  it('GET /api/places/:placeId/reviews returns place reviews', async () => {
    const placeId = 'placeholder-reviews-place'
    await appRuntime.runPromise(
      Effect.gen(function* () {
        yield* createPlace({
          id: placeId,
          googleMapsUri: 'https://maps.google.com/?cid=placeholder-reviews-place',
          name: 'Placeholder Reviews Place',
          lat: 40.12,
          lng: 9.14,
        })
        yield* createReview(placeId, 5, 'Excellent stay with sea view', '2 months ago')
      })
    )

    const res = await request(app).get(`/api/places/${placeId}/reviews`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({
      placeId,
      rating: 5,
      text: 'Excellent stay with sea view',
      relativeDate: '2 months ago',
    })
  })

  it('GET /api/shortlists returns empty array', async () => {
    const res = await request(app).get('/api/shortlists')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

describe('test support API', () => {
  beforeEach(async () => {
    resetScrapeRouteStateForTests()
    await appRuntime.runPromise(truncateAllTables())
  })

  it('POST /api/test/reset-db truncates persisted fixtures', async () => {
    const project = await request(app)
      .post('/api/projects')
      .send({
        name: 'Reset Fixtures Project',
        bounds: JSON.stringify({
          sw: { lat: 39.0, lng: 8.0 },
          ne: { lat: 39.2, lng: 8.2 },
        }),
      })
    expect(project.status).toBe(201)

    const seeded = await request(app)
      .post('/api/test/seed-fixtures')
      .send({
        existingProjectId: project.body.id as string,
        project: {
          name: 'Ignored Name',
          bounds: JSON.stringify({
            sw: { lat: 39.0, lng: 8.0 },
            ne: { lat: 39.2, lng: 8.2 },
          }),
        },
        scrapeRun: {
          query: 'seed query',
          status: 'completed',
          tilesTotal: 1,
          tilesCompleted: 1,
          placesFound: 1,
          placesUnique: 1,
        },
        places: [
          {
            id: 'seed-place-1',
            googleMapsUri: 'https://maps.google.com/?cid=seed-place-1',
            name: 'Seed Place 1',
            lat: 39.11,
            lng: 8.11,
          },
        ],
      })
    expect(seeded.status).toBe(201)
    expect(seeded.body.projectId).toBe(project.body.id)

    const reset = await request(app).post('/api/test/reset-db').send({})
    expect(reset.status).toBe(204)

    const projects = await request(app).get('/api/projects')
    expect(projects.status).toBe(200)
    expect(projects.body).toEqual([])
  })

  it('POST /api/test/seed-fixtures validates payloads', async () => {
    const response = await request(app)
      .post('/api/test/seed-fixtures')
      .send({
        project: {
          name: 'Invalid Fixtures',
          bounds: 42,
        },
      })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('Invalid fixture payload for /api/test/seed-fixtures')
  })
})

describe('db modules', () => {
  beforeEach(async () => {
    await appRuntime.runPromise(truncateAllTables())
  })

  it('covers shortlist lifecycle and not-found paths', async () => {
    const project = await appRuntime.runPromise(createProject('Shortlist Project'))
    const shortlist = await appRuntime.runPromise(createShortlist(project.id, 'Favorites'))
    expect(shortlist.projectId).toBe(project.id)
    expect(shortlist.name).toBe('Favorites')

    const fetchedShortlist = await appRuntime.runPromise(getShortlist(shortlist.id))
    expect(fetchedShortlist.id).toBe(shortlist.id)

    const listedShortlists = await appRuntime.runPromise(listShortlists(project.id))
    expect(listedShortlists).toHaveLength(1)
    expect(listedShortlists[0].id).toBe(shortlist.id)

    const updatedShortlist = await appRuntime.runPromise(updateShortlist(shortlist.id, 'Top Picks'))
    expect(updatedShortlist.name).toBe('Top Picks')

    await expect(appRuntime.runPromise(getShortlist(randomUUID()))).rejects.toBeDefined()

    const place = await appRuntime.runPromise(
      createPlace({
        id: 'shortlist-place-1',
        googleMapsUri: 'https://maps.google.com/?cid=shortlist-place-1',
        name: 'Shortlist Place 1',
        lat: 40.12,
        lng: 9.12,
      })
    )

    const createdEntry = await appRuntime.runPromise(addShortlistEntry(shortlist.id, place.id))
    expect(createdEntry.notes).toBe('')

    const fetchedEntry = await appRuntime.runPromise(getShortlistEntry(shortlist.id, place.id))
    expect(fetchedEntry.placeId).toBe(place.id)

    const listedEntries = await appRuntime.runPromise(listShortlistEntries(shortlist.id))
    expect(listedEntries).toHaveLength(1)

    const updatedEntry = await appRuntime.runPromise(
      updateShortlistEntryNotes(shortlist.id, place.id, 'Has pool and parking')
    )
    expect(updatedEntry.notes).toBe('Has pool and parking')

    await expect(appRuntime.runPromise(getShortlistEntry(shortlist.id, randomUUID()))).rejects.toBeDefined()

    await expect(
      appRuntime.runPromise(updateShortlistEntryNotes(shortlist.id, randomUUID(), 'Missing entry'))
    ).rejects.toBeDefined()

    expect(await appRuntime.runPromise(removeShortlistEntry(shortlist.id, place.id))).toBe(true)
    expect(await appRuntime.runPromise(removeShortlistEntry(shortlist.id, place.id))).toBe(false)

    expect(await appRuntime.runPromise(deleteShortlist(shortlist.id))).toBe(true)
    expect(await appRuntime.runPromise(deleteShortlist(shortlist.id))).toBe(false)
  })

  it('covers review and place-scrape-run lifecycle functions', async () => {
    const project = await appRuntime.runPromise(createProject('Review Project'))
    const scrapeRun = await appRuntime.runPromise(createScrapeRun(project.id, 'boutique hotels'))
    const place = await appRuntime.runPromise(
      createPlace({
        id: 'review-place-1',
        googleMapsUri: 'https://maps.google.com/?cid=review-place-1',
        name: 'Review Place 1',
        lat: 41.21,
        lng: 10.31,
      })
    )

    await appRuntime.runPromise(linkPlaceToScrapeRun(place.id, scrapeRun.id))
    await appRuntime.runPromise(linkPlaceToScrapeRun(place.id, scrapeRun.id))

    const links = await appRuntime.runPromise(listPlaceScrapeRuns(scrapeRun.id))
    expect(links).toHaveLength(1)
    expect(links[0]).toEqual({
      placeId: place.id,
      scrapeRunId: scrapeRun.id,
    })

    expect(await appRuntime.runPromise(unlinkPlaceFromScrapeRun(place.id, scrapeRun.id))).toBe(true)
    expect(await appRuntime.runPromise(unlinkPlaceFromScrapeRun(place.id, scrapeRun.id))).toBe(false)

    const reviewOne = await appRuntime.runPromise(createReview(place.id, 5, 'Amazing stay'))
    const reviewTwo = await appRuntime.runPromise(createReview(place.id, 4, 'Great location', '1 week ago'))
    expect(reviewTwo.relativeDate).toBe('1 week ago')

    const fetchedReview = await appRuntime.runPromise(getReview(reviewOne.id))
    expect(fetchedReview.text).toBe('Amazing stay')

    const reviews = await appRuntime.runPromise(listReviews(place.id))
    expect(reviews).toHaveLength(2)

    expect(await appRuntime.runPromise(deleteReview(reviewOne.id))).toBe(true)
    expect(await appRuntime.runPromise(deleteReview(reviewOne.id))).toBe(false)

    expect(await appRuntime.runPromise(deleteReviewsByPlace(place.id))).toBe(1)

    await expect(appRuntime.runPromise(getReview(reviewOne.id))).rejects.toBeDefined()
  })

  it('returns current run when scrape run updates are empty', async () => {
    const project = await appRuntime.runPromise(createProject('No-op Update Project'))
    const scrapeRun = await appRuntime.runPromise(createScrapeRun(project.id, 'no-op query'))

    const unchangedRun = await appRuntime.runPromise(updateScrapeRun(scrapeRun.id, {}))
    expect(unchangedRun.id).toBe(scrapeRun.id)
    expect(unchangedRun.query).toBe('no-op query')
    expect(unchangedRun.status).toBe('pending')
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
