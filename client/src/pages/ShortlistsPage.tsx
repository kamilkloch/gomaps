import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createShortlist,
  deleteShortlist,
  getErrorMessage,
  getProject,
  listPlaces,
  listProjects,
  listShortlistEntries,
  listShortlists,
  removeShortlistEntry,
  updateShortlist,
  updateShortlistEntryNotes,
  type Place,
  type Project,
  type Shortlist,
  type ShortlistEntry,
} from '../lib/api'

const DEFAULT_SHORTLIST_NAME = 'Starred'

interface ShortlistRow {
  entry: ShortlistEntry
  place: Place
}

export function ShortlistsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [shortlists, setShortlists] = useState<Shortlist[]>([])
  const [selectedShortlistId, setSelectedShortlistId] = useState<string | null>(null)
  const [entries, setEntries] = useState<ShortlistEntry[]>([])
  const [placesById, setPlacesById] = useState<Record<string, Place>>({})
  const [newShortlistName, setNewShortlistName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<string[]>([])

  const selectedShortlist = useMemo(
    () => shortlists.find((shortlist) => shortlist.id === selectedShortlistId) ?? null,
    [selectedShortlistId, shortlists],
  )

  const shortlistRows = useMemo(
    () =>
      entries
        .map((entry) => ({
          entry,
          place: placesById[entry.placeId],
        }))
        .filter((row): row is ShortlistRow => Boolean(row.place))
        .sort((a, b) => a.place.name.localeCompare(b.place.name, undefined, { sensitivity: 'base' })),
    [entries, placesById],
  )

  useEffect(() => {
    let isCancelled = false

    const loadProjects = async () => {
      try {
        const loadedProjects = await listProjects()
        if (isCancelled) {
          return
        }

        setProjects(loadedProjects)
        setSelectedProjectId(loadedProjects[0]?.id ?? null)
      }
      catch (error) {
        if (!isCancelled) {
          setErrorMessage(getErrorMessage(error, 'Unable to load projects right now.'))
        }
      }
    }

    void loadProjects()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedProject(null)
      setShortlists([])
      setSelectedShortlistId(null)
      setPlacesById({})
      return
    }

    let isCancelled = false

    const loadProjectData = async () => {
      try {
        setErrorMessage(null)
        const [project, projectPlaces, projectShortlists] = await Promise.all([
          getProject(selectedProjectId),
          listPlaces(selectedProjectId),
          listShortlists(selectedProjectId),
        ])

        if (isCancelled) {
          return
        }

        const shortlistByName = projectShortlists.find((shortlist) => shortlist.name === DEFAULT_SHORTLIST_NAME)
        if (!shortlistByName) {
          const defaultShortlist = await createShortlist(selectedProjectId, DEFAULT_SHORTLIST_NAME)
          if (isCancelled) {
            return
          }
          projectShortlists.push(defaultShortlist)
        }

        setSelectedProject(project)
        setPlacesById(Object.fromEntries(projectPlaces.map((place) => [place.id, place])))
        setShortlists(projectShortlists)
        setSelectedShortlistId((current) =>
          current && projectShortlists.some((shortlist) => shortlist.id === current)
            ? current
            : projectShortlists[0]?.id ?? null)
      }
      catch (error) {
        if (!isCancelled) {
          setErrorMessage(getErrorMessage(error, 'Unable to load shortlists right now.'))
        }
      }
    }

    void loadProjectData()

    return () => {
      isCancelled = true
    }
  }, [selectedProjectId])

  useEffect(() => {
    if (!selectedShortlistId) {
      setEntries([])
      setSelectedPlaceIds([])
      return
    }

    let isCancelled = false

    const loadEntries = async () => {
      try {
        setErrorMessage(null)
        const shortlistEntries = await listShortlistEntries(selectedShortlistId)
        if (!isCancelled) {
          setEntries(shortlistEntries)
        }
      }
      catch (error) {
        if (!isCancelled) {
          setErrorMessage(getErrorMessage(error, 'Unable to load shortlist entries right now.'))
        }
      }
    }

    void loadEntries()

    return () => {
      isCancelled = true
    }
  }, [selectedShortlistId])

  const handleCreateShortlist = useCallback(async () => {
    if (!selectedProjectId) {
      return
    }

    const trimmedName = newShortlistName.trim()
    if (!trimmedName) {
      setErrorMessage('Enter a shortlist name.')
      return
    }

    try {
      setIsSubmitting(true)
      setErrorMessage(null)
      const shortlist = await createShortlist(selectedProjectId, trimmedName)
      setShortlists((current) => [...current, shortlist])
      setSelectedShortlistId(shortlist.id)
      setNewShortlistName('')
    }
    catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to create shortlist right now.'))
    }
    finally {
      setIsSubmitting(false)
    }
  }, [newShortlistName, selectedProjectId])

  const handleRenameShortlist = useCallback(async (shortlistId: string, currentName: string) => {
    const nextName = window.prompt('Rename shortlist', currentName)?.trim()
    if (!nextName || nextName === currentName) {
      return
    }

    try {
      setErrorMessage(null)
      const updated = await updateShortlist(shortlistId, nextName)
      setShortlists((current) => current.map((shortlist) => (shortlist.id === shortlistId ? updated : shortlist)))
    }
    catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to rename shortlist right now.'))
    }
  }, [])

  const handleDeleteShortlist = useCallback(async (shortlistId: string, name: string) => {
    if (!window.confirm(`Delete shortlist "${name}"?`)) {
      return
    }

    try {
      setErrorMessage(null)
      await deleteShortlist(shortlistId)
      setShortlists((current) => current.filter((shortlist) => shortlist.id !== shortlistId))
      setSelectedShortlistId((current) => (current === shortlistId ? null : current))
    }
    catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to delete shortlist right now.'))
    }
  }, [])

  const handleUpdateNotes = useCallback(async (placeId: string, notes: string) => {
    if (!selectedShortlistId) {
      return
    }

    try {
      const updatedEntry = await updateShortlistEntryNotes(selectedShortlistId, placeId, notes)
      setEntries((current) =>
        current.map((entry) =>
          entry.placeId === placeId
            ? updatedEntry
            : entry,
        ))
    }
    catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to update notes right now.'))
    }
  }, [selectedShortlistId])

  const handleRemoveEntry = useCallback(async (placeId: string) => {
    if (!selectedShortlistId) {
      return
    }

    try {
      await removeShortlistEntry(selectedShortlistId, placeId)
      setEntries((current) => current.filter((entry) => entry.placeId !== placeId))
      setSelectedPlaceIds((current) => current.filter((id) => id !== placeId))
    }
    catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to remove shortlist entry right now.'))
    }
  }, [selectedShortlistId])

  useEffect(() => {
    setSelectedPlaceIds((current) => current.filter((placeId) => shortlistRows.some((row) => row.place.id === placeId)))
  }, [shortlistRows])

  const selectedRows = useMemo(
    () => shortlistRows.filter((row) => selectedPlaceIds.includes(row.place.id)),
    [selectedPlaceIds, shortlistRows],
  )

  const comparisonRows = selectedRows.slice(0, 3)

  const comparisonDisabled = comparisonRows.length < 2

  const togglePlaceSelection = useCallback((placeId: string) => {
    setSelectedPlaceIds((current) => {
      if (current.includes(placeId)) {
        return current.filter((id) => id !== placeId)
      }

      if (current.length >= 3) {
        return current
      }

      return [...current, placeId]
    })
  }, [])

  const handleExportCsv = useCallback(() => {
    if (!selectedShortlist) {
      return
    }

    const exportRows = shortlistRows.map(({ entry, place }) => ({
      ...place,
      notes: entry.notes,
    }))

    const csv = toCsv(exportRows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const normalizedShortlistName = selectedShortlist.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    link.href = objectUrl
    link.download = `${normalizedShortlistName || 'shortlist'}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(objectUrl)
  }, [selectedShortlist, shortlistRows])

  return (
    <main className="shortlists-page" data-testid="shortlists-page">
      <header className="shortlists-header">
        <div>
          <p className="shortlists-breadcrumbs">Projects &gt; {selectedProject?.name ?? '—'} &gt; Shortlists</p>
          <h1 data-testid="shortlists-title">{selectedShortlist?.name ?? 'Shortlists'}</h1>
        </div>
        <div className="shortlists-project-picker">
          <label htmlFor="shortlists-project-select">Project</label>
          <select
            id="shortlists-project-select"
            data-testid="shortlists-project-select"
            value={selectedProjectId ?? ''}
            onChange={(event) => setSelectedProjectId(event.target.value || null)}
            disabled={projects.length === 0}
          >
            {projects.length === 0 ? <option value="">No projects</option> : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>
      </header>

      {errorMessage ? <p className="shortlists-error" data-testid="shortlists-error">{errorMessage}</p> : null}

      <section className="shortlists-layout">
        <aside className="shortlists-sidebar" data-testid="shortlists-sidebar" role="region" aria-label="Shortlists sidebar">
          <h2>Shortlists</h2>
          <ul>
            {shortlists.map((shortlist) => (
              <li key={shortlist.id}>
                <button
                  type="button"
                  className={shortlist.id === selectedShortlistId ? 'is-active' : ''}
                  data-testid={`shortlist-item-${shortlist.id}`}
                  onClick={() => setSelectedShortlistId(shortlist.id)}
                >
                  <span>{shortlist.name}</span>
                  <span>{shortlist.id === selectedShortlistId ? entries.length : '•'}</span>
                </button>
                <div className="shortlists-sidebar-actions">
                  <button
                    type="button"
                    onClick={() => {
                      void handleRenameShortlist(shortlist.id, shortlist.name)
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleDeleteShortlist(shortlist.id, shortlist.name)
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="shortlists-create-row">
            <input
              data-testid="shortlists-create-input"
              type="text"
              placeholder="Create shortlist"
              value={newShortlistName}
              onChange={(event) => setNewShortlistName(event.target.value)}
            />
            <button
              data-testid="shortlists-create-button"
              type="button"
              onClick={() => {
                void handleCreateShortlist()
              }}
              disabled={isSubmitting || !selectedProjectId}
            >
              + Create Shortlist
            </button>
          </div>
        </aside>

        <section className="shortlists-main" data-testid="shortlists-main" role="region" aria-label="Shortlist entries">
          <div className="shortlists-main-header">
            <h2>{selectedShortlist?.name ?? 'No shortlist selected'}</h2>
            <div className="shortlists-main-header-actions">
              <span>{shortlistRows.length} places</span>
              <button
                type="button"
                className="shortlists-compare-button"
                data-testid="shortlists-compare-button"
                disabled={comparisonDisabled}
              >
                Compare ({comparisonRows.length})
              </button>
              <button
                type="button"
                className="shortlists-export-button"
                data-testid="shortlists-export-button"
                disabled={shortlistRows.length === 0}
                onClick={handleExportCsv}
              >
                Export CSV
              </button>
            </div>
          </div>

          {comparisonRows.length > 0 ? (
            <section className="shortlists-comparison" data-testid="shortlists-comparison">
              {comparisonRows.map(({ entry, place }) => {
                const photoUrls = parseJsonArray(place.photoUrls)
                const amenities = parseJsonArray(place.amenities).slice(0, 4)
                const imageSource = photoUrls[0] ?? null

                return (
                  <article key={place.id} className="shortlists-comparison-card" data-testid={`shortlists-comparison-card-${place.id}`}>
                    {imageSource ? (
                      <img src={imageSource} alt={`${place.name} preview`} loading="lazy" />
                    ) : (
                      <div className="shortlists-comparison-image-fallback">No photo</div>
                    )}
                    <h3>{place.name}</h3>
                    <p>
                      <strong>{place.rating?.toFixed(1) ?? '—'}</strong> · {place.reviewCount ?? '—'} reviews
                    </p>
                    <p>{formatPriceLevel(place.priceLevel)}</p>
                    <span className={`shortlists-website-badge shortlists-website-${place.websiteType}`}>
                      {place.websiteType === 'direct' ? 'Direct' : place.websiteType.toUpperCase()}
                    </span>
                    <div className="shortlists-comparison-amenities">
                      {amenities.length === 0 ? <span className="shortlists-comparison-amenity">No amenities</span> : amenities.map((amenity) => (
                        <span key={amenity} className="shortlists-comparison-amenity">{amenity}</span>
                      ))}
                    </div>
                    <p className="shortlists-comparison-address">{place.address ?? 'No address available'}</p>
                    {entry.notes.trim() ? <p className="shortlists-comparison-notes">Note: {entry.notes}</p> : null}
                  </article>
                )
              })}
            </section>
          ) : null}

          {selectedPlaceIds.length >= 3 ? (
            <p className="shortlists-selection-cap" data-testid="shortlists-selection-cap">Maximum 3 places can be compared.</p>
          ) : null}

          <div className="shortlists-table-wrap">
            <table data-testid="shortlists-table">
              <thead>
                <tr>
                  <th>✓</th>
                  <th>Name</th>
                  <th>Rating</th>
                  <th>Reviews</th>
                  <th>Price</th>
                  <th>Website</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shortlistRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="shortlists-empty-row">No places in this shortlist yet.</td>
                  </tr>
                ) : (
                  shortlistRows.map(({ entry, place }) => {
                    const isSelected = selectedPlaceIds.includes(place.id)

                    return (
                      <tr key={place.id} data-selected={isSelected ? 'true' : 'false'}>
                        <td>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => togglePlaceSelection(place.id)}
                            aria-label={`Select ${place.name}`}
                          />
                        </td>
                        <td>{place.name}</td>
                        <td>{place.rating?.toFixed(1) ?? '—'}</td>
                        <td>{place.reviewCount ?? '—'}</td>
                        <td>{formatPriceLevel(place.priceLevel)}</td>
                        <td>
                          <span className={`shortlists-website-badge shortlists-website-${place.websiteType}`}>
                            {place.websiteType.toUpperCase()}
                          </span>
                        </td>
                        <td>
                          <input
                            data-testid={`shortlist-note-${place.id}`}
                            type="text"
                            defaultValue={entry.notes}
                            placeholder="[Add a note]"
                            onBlur={(event) => {
                              void handleUpdateNotes(place.id, event.target.value)
                            }}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="shortlists-remove-entry"
                            aria-label={`Remove ${place.name} from shortlist`}
                            onClick={() => {
                              void handleRemoveEntry(place.id)
                            }}
                          >
                            🗑
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  )
}

interface ExportShortlistRow extends Place {
  notes: string
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  }
  catch {
    return []
  }
}

function escapeCsvValue(value: string): string {
  return `"${value.split('"').join('""')}"`
}

function toCsv(rows: ExportShortlistRow[]): string {
  const headers: Array<keyof ExportShortlistRow> = [
    'id',
    'googleMapsUri',
    'googleMapsPhotosUri',
    'name',
    'category',
    'rating',
    'reviewCount',
    'priceLevel',
    'phone',
    'website',
    'websiteType',
    'address',
    'lat',
    'lng',
    'photoUrls',
    'openingHours',
    'amenities',
    'scrapedAt',
    'notes',
  ]

  const lines = rows.map((row) => headers.map((header) => {
    const value = row[header]
    if (value === null || value === undefined) {
      return '""'
    }

    if (typeof value === 'number') {
      return escapeCsvValue(String(value))
    }

    return escapeCsvValue(value)
  }).join(','))

  return [headers.join(','), ...lines].join('\n')
}

function formatPriceLevel(priceLevel: string | null): string {
  if (!priceLevel) {
    return '—'
  }

  const normalized = priceLevel.trim()
  if (normalized.startsWith('$')) {
    return normalized
  }

  if (normalized.startsWith('PRICE_LEVEL_')) {
    return normalized
      .replace('PRICE_LEVEL_', '')
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  return normalized
}
