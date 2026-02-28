import { APIProvider, Map } from '@vis.gl/react-google-maps'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createProject,
  deleteProject,
  getErrorMessage,
  listProjects,
  type Project,
} from '../lib/api'

interface Bounds {
  sw: { lat: number; lng: number }
  ne: { lat: number; lng: number }
}

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

export function ProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const hasProjects = projects.length > 0
  const hasMapsKey = Boolean(MAPS_API_KEY)

  useEffect(() => {
    void loadProjects()
  }, [])

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )

  async function loadProjects() {
    try {
      setIsLoading(true)
      setErrorMessage(null)
      const loadedProjects = await listProjects()
      setProjects(loadedProjects)
      setSelectedProjectId((currentSelection) =>
        currentSelection && loadedProjects.some((project) => project.id === currentSelection)
          ? currentSelection
          : loadedProjects[0]?.id ?? null,
      )
    }
    catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to load projects. Please try again.'))
    }
    finally {
      setIsLoading(false)
    }
  }

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = newProjectName.trim()
    if (!trimmedName) {
      return
    }

    try {
      setIsCreating(true)
      await createProject({ name: trimmedName })
      setNewProjectName('')
      setShowCreateForm(false)
      await loadProjects()
    }
    catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to create project. Please try again.'))
    }
    finally {
      setIsCreating(false)
    }
  }

  async function handleDeleteProject(project: Project) {
    const shouldDelete = window.confirm(`Delete project "${project.name}"?`)
    if (!shouldDelete) {
      return
    }

    try {
      await deleteProject(project.id)
      await loadProjects()
    }
    catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to delete project. Please try again.'))
    }
  }

  return (
    <main className="projects-page" data-testid="projects-page">
      <header className="projects-header">
        <div>
          <h1 data-testid="projects-page-title">Projects</h1>
          <p>Manage your scrape areas and jump into setup quickly.</p>
        </div>
        <button
          data-testid="projects-new-button"
          className="new-project-button"
          type="button"
          onClick={() => setShowCreateForm((open) => !open)}
        >
          + New Project
        </button>
      </header>

      {showCreateForm ? (
        <form className="project-form" data-testid="projects-create-form" onSubmit={handleCreateProject}>
          <label htmlFor="project-name">Project name</label>
          <div className="project-form-row">
            <input
              data-testid="projects-create-name-input"
              id="project-name"
              type="text"
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="Sardinia Summer 2026"
              required
            />
            <button data-testid="projects-create-submit" type="submit" disabled={isCreating}>
              {isCreating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      ) : null}

      {errorMessage ? <p className="projects-error" data-testid="projects-error">{errorMessage}</p> : null}

      {isLoading ? <p className="projects-loading">Loading projects…</p> : null}

      {!isLoading && !hasProjects ? (
        <section className="projects-grid" aria-label="Projects list">
          <button
            data-testid="projects-empty-create-button"
            className="empty-project-card"
            type="button"
            onClick={() => setShowCreateForm(true)}
          >
            <span className="empty-project-plus">+</span>
            <span>Create your first project</span>
          </button>
        </section>
      ) : null}

      {!isLoading && hasProjects ? (
        <section className="projects-grid" aria-label="Projects list">
          {hasMapsKey ? <APIProvider apiKey={MAPS_API_KEY ?? ''}>{renderCards()}</APIProvider> : renderCards()}
        </section>
      ) : null}

      {selectedProject ? (
        <p className="selected-project-copy">Selected: {selectedProject.name}</p>
      ) : null}
    </main>
  )

  function renderCards() {
    return projects.map((project) => {
      const bounds = parseBounds(project.bounds)
      const status = bounds ? 'Complete' : 'Draft'
      const isSelected = selectedProjectId === project.id

      return (
        <article
          key={project.id}
          data-testid={`project-card-${project.id}`}
          className={`project-card ${isSelected ? 'is-selected' : ''}`}
          onClick={() => {
            setSelectedProjectId(project.id)
            navigate(`/projects/${project.id}/setup`)
          }}
          onMouseEnter={() => setSelectedProjectId(project.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setSelectedProjectId(project.id)
              navigate(`/projects/${project.id}/setup`)
            }
          }}
        >
          <div className="project-card-header">
            <h2 data-testid={`project-name-${project.id}`}>{project.name}</h2>
            <span className={`project-status project-status-${status.toLowerCase()}`}>
              {status}
            </span>
          </div>

          <div className="project-map-preview" aria-label={`${project.name} map preview`}>
            {hasMapsKey ? (
              <Map
                defaultCenter={getCenter(bounds)}
                defaultZoom={estimateZoom(bounds)}
                gestureHandling="none"
                disableDefaultUI
                style={{ width: '100%', height: '100%' }}
              />
            ) : (
              <div className="project-map-fallback">Google Maps preview unavailable</div>
            )}

            {bounds ? (
              <div className="preview-bounds-overlay">
                <span className="preview-marker preview-marker-sw" />
                <span className="preview-marker preview-marker-ne" />
              </div>
            ) : null}
          </div>

          <footer className="project-card-footer">
            <span>Places: 0</span>
            <span>Scrape runs: 0</span>
            <span>Last scraped: never</span>
          </footer>

          <button
            data-testid={`project-delete-${project.id}`}
            className="delete-project-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void handleDeleteProject(project)
            }}
          >
            Delete
          </button>
        </article>
      )
    })
  }
}

const getCenter = (bounds: Bounds | null) => {
  if (!bounds) {
    return { lat: 40, lng: 9 }
  }

  return {
    lat: (bounds.sw.lat + bounds.ne.lat) / 2,
    lng: (bounds.sw.lng + bounds.ne.lng) / 2,
  }
}

const estimateZoom = (bounds: Bounds | null): number => {
  if (!bounds) {
    return 5
  }

  const latSpan = Math.abs(bounds.ne.lat - bounds.sw.lat)
  if (latSpan < 0.2) {
    return 11
  }

  if (latSpan < 0.6) {
    return 9
  }

  if (latSpan < 1.2) {
    return 8
  }

  return 7
}

const parseBounds = (rawBounds: string | null): Bounds | null => {
  if (!rawBounds) {
    return null
  }

  try {
    const parsed = JSON.parse(rawBounds) as Bounds
    if (
      Number.isFinite(parsed.sw.lat)
      && Number.isFinite(parsed.sw.lng)
      && Number.isFinite(parsed.ne.lat)
      && Number.isFinite(parsed.ne.lng)
    ) {
      return parsed
    }
  }
  catch {
    return null
  }

  return null
}
