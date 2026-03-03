import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addShortlistEntry,
  ApiRequestError,
  createShortlist,
  deleteShortlist,
  getProject,
  getScrapeStatus,
  listShortlistEntries,
  listShortlists,
  listPlaceReviews,
  listPlaces,
  listRunTiles,
  listScrapeRuns,
  pauseScrape,
  removeShortlistEntry,
  resumeScrape,
  startScrape,
  updateShortlist,
  updateShortlistEntryNotes,
  updateProject,
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

  it('gets a project by id', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'p-42', name: 'Rome' }), { status: 200 }))

    const result = await getProject('p-42')

    expect(result).toEqual({ id: 'p-42', name: 'Rome' })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/projects/p-42',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    )
  })

  it('updates a project with PUT JSON body', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'p1', name: 'Updated', bounds: 'bbox' }), { status: 200 }),
    )

    const result = await updateProject('p1', { name: 'Updated', bounds: 'bbox' })

    expect(result).toEqual({ id: 'p1', name: 'Updated', bounds: 'bbox' })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/projects/p1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ name: 'Updated', bounds: 'bbox' }),
      }),
    )
  })

  it('lists scrape runs with encoded project query', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'run-1' }]), { status: 200 }))

    const result = await listScrapeRuns('project/id with spaces')

    expect(result).toEqual([{ id: 'run-1' }])
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/scrape?projectId=project%2Fid%20with%20spaces',
      expect.any(Object),
    )
  })

  it('gets scrape status for a run', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ scrapeRunId: 'run-9', status: 'running' }), { status: 200 }),
    )

    const result = await getScrapeStatus('run-9')
    expect(result).toEqual({ scrapeRunId: 'run-9', status: 'running' })
    expect(mockFetch).toHaveBeenCalledWith('/api/scrape/run-9', expect.any(Object))
  })

  it('lists tiles for a run', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'tile-1' }]), { status: 200 }))

    const result = await listRunTiles('run-2')
    expect(result).toEqual([{ id: 'tile-1' }])
    expect(mockFetch).toHaveBeenCalledWith('/api/scrape/run-2/tiles', expect.any(Object))
  })

  it('lists places with and without a project filter', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'place-1' }]), { status: 200 }))
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'place-2' }]), { status: 200 }))

    const unfiltered = await listPlaces()
    const filtered = await listPlaces('project-1')

    expect(unfiltered).toEqual([{ id: 'place-1' }])
    expect(filtered).toEqual([{ id: 'place-2' }])
    expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/places', expect.any(Object))
    expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/places?projectId=project-1', expect.any(Object))
  })

  it('lists place reviews using encoded place id', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'r-1' }]), { status: 200 }))

    const result = await listPlaceReviews('ChIJ abc/123')
    expect(result).toEqual([{ id: 'r-1' }])
    expect(mockFetch).toHaveBeenCalledWith('/api/places/ChIJ%20abc%2F123/reviews', expect.any(Object))
  })

  it('handles shortlist CRUD and entry requests', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 's1' }]), { status: 200 }))
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 's2', projectId: 'p1', name: 'Top Picks' }), { status: 201 }))
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 's2', projectId: 'p1', name: 'Renamed' }), { status: 200 }))
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))

    const listed = await listShortlists('project/id')
    const created = await createShortlist('p1', 'Top Picks')
    const updated = await updateShortlist('s2', 'Renamed')
    await deleteShortlist('s2')

    expect(listed).toEqual([{ id: 's1' }])
    expect(created).toEqual({ id: 's2', projectId: 'p1', name: 'Top Picks' })
    expect(updated).toEqual({ id: 's2', projectId: 'p1', name: 'Renamed' })
    expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/shortlists?projectId=project%2Fid', expect.any(Object))
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/shortlists',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ projectId: 'p1', name: 'Top Picks' }),
      }),
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      '/api/shortlists/s2',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ name: 'Renamed' }),
      }),
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      '/api/shortlists/s2',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('handles shortlist entry CRUD requests', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([{ shortlistId: 's1', placeId: 'p1', notes: '' }]), { status: 200 }))
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ shortlistId: 's1', placeId: 'p2', notes: 'Great pool' }), { status: 201 }))
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ shortlistId: 's1', placeId: 'p2', notes: 'Updated' }), { status: 200 }))
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }))

    const listedEntries = await listShortlistEntries('s1')
    const addedEntry = await addShortlistEntry('s1', 'p2', 'Great pool')
    const updatedEntry = await updateShortlistEntryNotes('s1', 'p2', 'Updated')
    await removeShortlistEntry('s1', 'p2')

    expect(listedEntries).toEqual([{ shortlistId: 's1', placeId: 'p1', notes: '' }])
    expect(addedEntry).toEqual({ shortlistId: 's1', placeId: 'p2', notes: 'Great pool' })
    expect(updatedEntry).toEqual({ shortlistId: 's1', placeId: 'p2', notes: 'Updated' })
    expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/shortlists/s1/entries', expect.any(Object))
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/shortlists/s1/entries',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ placeId: 'p2', notes: 'Great pool' }),
      }),
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      '/api/shortlists/s1/entries/p2',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ notes: 'Updated' }),
      }),
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      '/api/shortlists/s1/entries/p2',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('starts scrape with project and query payload', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ scrapeRunId: 'run-7' }), { status: 200 }))

    const result = await startScrape('project-7', 'hotel')
    expect(result).toEqual({ scrapeRunId: 'run-7' })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/scrape/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ projectId: 'project-7', query: 'hotel' }),
      }),
    )
  })

  it('pauses and resumes scrape runs', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pausing' }), { status: 200 }))
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'running' }), { status: 200 }))

    const paused = await pauseScrape('run-10')
    const resumed = await resumeScrape('run-10')

    expect(paused).toEqual({ status: 'pausing' })
    expect(resumed).toEqual({ status: 'running' })
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      '/api/scrape/run-10/pause',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/scrape/run-10/resume',
      expect.objectContaining({ method: 'POST' }),
    )
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

  it('throws generic status message when error body is empty', async () => {
    mockFetch.mockResolvedValueOnce(new Response('   ', { status: 500 }))

    await expect(listProjects()).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 500,
      message: 'Request failed with status 500',
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
