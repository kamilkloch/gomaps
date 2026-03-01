import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiRequestError,
  createProject,
  deleteProject,
  getErrorMessage,
  listProjects,
  subscribeScrapeProgress,
} from './api'

interface MockEventSource {
  url: string
  onmessage: ((event: MessageEvent<string>) => void) | null
  onerror: (() => void) | null
  close: ReturnType<typeof vi.fn>
}

const mockFetch = vi.fn<typeof fetch>()
const eventSources: MockEventSource[] = []

class FakeEventSource {
  url: string
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()

  constructor(url: string) {
    this.url = url
    eventSources.push(this as unknown as MockEventSource)
  }
}

describe('api helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
  })

  afterEach(() => {
    eventSources.length = 0
    mockFetch.mockReset()
    vi.unstubAllGlobals()
  })

  it('returns explicit error message when present', () => {
    expect(getErrorMessage(new Error('Boom'), 'Fallback')).toBe('Boom')
    expect(getErrorMessage(new Error('   '), 'Fallback')).toBe('Fallback')
    expect(getErrorMessage(null, 'Fallback')).toBe('Fallback')
  })

  it('lists projects using /api base path', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 'p1', name: 'Test' }]), { status: 200 }),
    )

    const result = await listProjects()

    expect(result).toEqual([{ id: 'p1', name: 'Test' }])
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    )
  })

  it('handles 204 responses for delete', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(deleteProject('p1')).resolves.toBeUndefined()
  })

  it('throws ApiRequestError with response message on non-2xx', async () => {
    mockFetch.mockResolvedValueOnce(new Response('project missing', { status: 404 }))

    await expect(createProject({ name: 'Sardinia' })).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 404,
      message: 'Request failed (404): project missing',
    })
  })

  it('returns routing hint on wrong backend 404 signature', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Cannot GET /api/projects', { status: 404 }))

    await expect(listProjects()).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 404,
      message: expect.stringContaining('GoMaps API is not reachable at /api'),
    })
  })

  it('subscribes to scrape progress and closes source on error or cleanup', () => {
    const onProgress = vi.fn()
    const onError = vi.fn()

    const unsubscribe = subscribeScrapeProgress('run-1', onProgress, onError)
    expect(eventSources).toHaveLength(1)
    expect(eventSources[0].url).toBe('/api/scrape/run-1/progress')

    eventSources[0].onmessage?.({
      data: JSON.stringify({ scrapeRunId: 'run-1', status: 'running' }),
    } as MessageEvent<string>)
    expect(onProgress).toHaveBeenCalledWith({ scrapeRunId: 'run-1', status: 'running' })

    eventSources[0].onerror?.()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(eventSources[0].close).toHaveBeenCalledTimes(1)

    unsubscribe()
    expect(eventSources[0].close).toHaveBeenCalledTimes(2)
  })

  it('preserves ApiRequestError via getErrorMessage', () => {
    const error = new ApiRequestError('Bad request', 400)
    expect(getErrorMessage(error, 'Fallback')).toBe('Bad request')
  })
})
