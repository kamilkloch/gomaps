export interface Project {
  id: string
  name: string
  bounds: string | null
  createdAt: string
}

interface CreateProjectInput {
  name: string
  bounds?: string
}

interface UpdateProjectInput {
  name?: string
  bounds?: string
}

export interface ScrapeRun {
  id: string
  projectId: string
  query: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  tilesTotal: number
  tilesCompleted: number
  tilesSubdivided: number
  placesFound: number
  placesUnique: number
  startedAt: string | null
  completedAt: string | null
}

export interface ScrapeProgress {
  scrapeRunId: string
  status: ScrapeRun['status']
  tilesTotal: number
  tilesCompleted: number
  tilesSubdivided: number
  placesFound: number
  placesUnique: number
  elapsedMs: number
}

export interface ScrapeTile {
  id: string
  scrapeRunId: string
  bounds: string
  zoomLevel: number
  status: 'pending' | 'running' | 'completed' | 'subdivided'
  resultCount: number
  parentTileId: string | null
}

export interface Place {
  id: string
  googleMapsUri: string
  name: string
  category: string | null
  rating: number | null
  reviewCount: number | null
  priceLevel: string | null
  phone: string | null
  website: string | null
  websiteType: 'direct' | 'ota' | 'social' | 'unknown'
  address: string | null
  lat: number
  lng: number
  photoUrls: string
  openingHours: string | null
  amenities: string
  scrapedAt: string
}

const API_BASE = '/api'

const API_ROUTING_HINT =
  'GoMaps API is not reachable at /api. Start the server (`npm run dev --workspace=server`) or set `VITE_API_PROXY_TARGET` to your GoMaps server URL before starting the client.'

export class ApiRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

export const getErrorMessage = (error: unknown, fallbackMessage: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return fallbackMessage
}

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const responseBody = await response.text()
    const isLikelyWrongBackend =
      response.status === 404 && /Cannot\s+(GET|POST|PUT|PATCH|DELETE)\s+\/api\//i.test(responseBody)

    if (isLikelyWrongBackend) {
      throw new ApiRequestError(API_ROUTING_HINT, response.status)
    }

    const responseMessage = responseBody.trim()
    throw new ApiRequestError(
      responseMessage.length > 0
        ? `Request failed (${response.status}): ${responseMessage}`
        : `Request failed with status ${response.status}`,
      response.status,
    )
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export const listProjects = async (): Promise<Project[]> => requestJson<Project[]>('/projects')

export const getProject = async (projectId: string): Promise<Project> =>
  requestJson<Project>(`/projects/${projectId}`)

export const createProject = async (input: CreateProjectInput): Promise<Project> =>
  requestJson<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  })

export const updateProject = async (projectId: string, input: UpdateProjectInput): Promise<Project> =>
  requestJson<Project>(`/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })

export const deleteProject = async (projectId: string): Promise<void> =>
  requestJson<void>(`/projects/${projectId}`, {
    method: 'DELETE',
  })

export const listScrapeRuns = async (projectId: string): Promise<ScrapeRun[]> =>
  requestJson<ScrapeRun[]>(`/scrape?projectId=${encodeURIComponent(projectId)}`)

export const getScrapeStatus = async (runId: string): Promise<ScrapeProgress> =>
  requestJson<ScrapeProgress>(`/scrape/${runId}`)

export const listRunTiles = async (runId: string): Promise<ScrapeTile[]> =>
  requestJson<ScrapeTile[]>(`/scrape/${runId}/tiles`)

export const listPlaces = async (projectId?: string): Promise<Place[]> =>
  requestJson<Place[]>(
    projectId
      ? `/places?projectId=${encodeURIComponent(projectId)}`
      : '/places'
  )

export const startScrape = async (
  projectId: string,
  query: string,
): Promise<{ scrapeRunId: string }> =>
  requestJson<{ scrapeRunId: string }>('/scrape/start', {
    method: 'POST',
    body: JSON.stringify({ projectId, query }),
  })

export const pauseScrape = async (runId: string): Promise<{ status: 'pausing' }> =>
  requestJson<{ status: 'pausing' }>(`/scrape/${runId}/pause`, {
    method: 'POST',
  })

export const resumeScrape = async (runId: string): Promise<{ status: 'running' }> =>
  requestJson<{ status: 'running' }>(`/scrape/${runId}/resume`, {
    method: 'POST',
  })

export const subscribeScrapeProgress = (
  runId: string,
  onProgress: (progress: ScrapeProgress) => void,
  onError?: () => void,
): (() => void) => {
  const source = new EventSource(`${API_BASE}/scrape/${runId}/progress`)

  source.onmessage = (event) => {
    const payload = JSON.parse(event.data) as ScrapeProgress
    onProgress(payload)
  }
  source.onerror = () => {
    source.close()
    onError?.()
  }

  return () => {
    source.close()
  }
}
