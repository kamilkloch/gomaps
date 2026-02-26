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

const API_BASE = '/api'

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
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
