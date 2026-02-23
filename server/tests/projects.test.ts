import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import request from 'supertest'

const dbPath = join(tmpdir(), `gomaps-test-${randomUUID()}.db`)

// Set DB_PATH before importing app so the singleton uses the test DB
process.env.DB_PATH = dbPath

const { app } = await import('../src/index.js')
import { closeDatabase } from '../src/db/index.js'

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
