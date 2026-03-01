import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ApiRequestError,
  getProject,
  getScrapeStatus,
  listRunTiles,
  listScrapeRuns,
  pauseScrape,
  resumeScrape,
  startScrape,
  subscribeScrapeProgress,
  updateProject,
  type Project,
  type ScrapeProgress,
  type ScrapeRun,
  type ScrapeTile,
} from '../lib/api'

interface Bounds {
  sw: { lat: number; lng: number }
  ne: { lat: number; lng: number }
}

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
const IS_E2E_TEST_MODE = import.meta.env.VITE_E2E_TEST_MODE === '1'
const FALLBACK_CENTER = { lat: 40, lng: 9 }
const MAPS_KEY_PLACEHOLDERS = new Set([
  'your_google_maps_api_key_here',
  'your_key_here',
])
const MAP_LOAD_ERROR_COPY =
  'Unable to load Google Maps. Check that your API key is valid and allows Maps JavaScript API for localhost.'
const MAP_INIT_TIMEOUT_COPY =
  'Map did not initialize. Verify `VITE_GOOGLE_MAPS_API_KEY`, ensure Maps JavaScript API is enabled, and allow `http://localhost:5173/*` in key referrer restrictions.'
const MAP_TILES_TIMEOUT_COPY =
  'Google Maps initialized but tiles did not render. Check network/ad-blockers and key referrer restrictions for map tile requests.'

export function SetupPage() {
  const { projectId } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [selectionBounds, setSelectionBounds] = useState<Bounds | null>(null)
  const [query, setQuery] = useState('vacation rentals')
  const [runs, setRuns] = useState<ScrapeRun[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ScrapeProgress | null>(null)
  const [runTiles, setRunTiles] = useState<ScrapeTile[]>([])
  const [map, setMap] = useState<google.maps.Map | null>(null)
  const [mapLoadErrorMessage, setMapLoadErrorMessage] = useState<string | null>(null)
  const [didMapInitTimeout, setDidMapInitTimeout] = useState(false)
  const [hasMapTilesLoaded, setHasMapTilesLoaded] = useState(false)
  const [didMapTilesTimeout, setDidMapTilesTimeout] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isStartingScrape, setIsStartingScrape] = useState(false)
  const [isTogglingRun, setIsTogglingRun] = useState(false)
  const [isProjectMissing, setIsProjectMissing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const hasAppliedInitialBounds = useRef(false)

  const selectRun = useCallback((runId: string | null) => {
    setActiveRunId(runId)
    setProgress(null)
    setRunTiles([])
  }, [])

  const forcedMapDiagnostic = getForcedMapDiagnostic()
  const forceMapLoadError = forcedMapDiagnostic === 'api-key-error'
  const forceMapInitTimeout = forcedMapDiagnostic === 'init-timeout'
  const forceMapTilesTimeout = forcedMapDiagnostic === 'tiles-timeout'
  const trimmedMapsKey = API_KEY?.trim() ?? ''
  const hasMapsKey = trimmedMapsKey.length > 0 && !MAPS_KEY_PLACEHOLDERS.has(trimmedMapsKey)
  const tileOverlayDebugSnapshot = runTiles.map((tile) => {
    const style = tileStyle(tile.status)
    return {
      id: tile.id,
      status: tile.status,
      visible: tile.status !== 'subdivided',
      fillColor: style.fillColor ?? null,
      strokeColor: style.strokeColor ?? null,
    }
  })

  useEffect(() => {
    hasAppliedInitialBounds.current = false
    setIsProjectMissing(false)
  }, [projectId])

  useEffect(() => {
    if (!forcedMapDiagnostic) {
      return
    }

    setMapLoadErrorMessage(forceMapLoadError ? MAP_LOAD_ERROR_COPY : null)
    setDidMapInitTimeout(forceMapInitTimeout)
    setDidMapTilesTimeout(forceMapTilesTimeout)
  }, [forceMapInitTimeout, forceMapLoadError, forceMapTilesTimeout, forcedMapDiagnostic])

  useEffect(() => {
    if (!projectId) {
      setIsLoading(false)
      return
    }

    let isCancelled = false

    const loadProject = async () => {
      try {
        setIsLoading(true)
        setErrorMessage(null)
        setIsProjectMissing(false)
        const loadedProject = await getProject(projectId)
        if (isCancelled) {
          return
        }

        setProject(loadedProject)
        setSelectionBounds(parseBounds(loadedProject.bounds))
      }
      catch (error) {
        if (!isCancelled) {
          if (error instanceof ApiRequestError && error.status === 404) {
            setProject(null)
            setSelectionBounds(null)
            setRuns([])
            selectRun(null)
            setIsProjectMissing(true)
            return
          }
          setErrorMessage('Unable to load project setup right now.')
        }
      }
      finally {
        if (!isCancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadProject()

    return () => {
      isCancelled = true
    }
  }, [projectId])

  useEffect(() => {
    if (!map || !selectionBounds || hasAppliedInitialBounds.current) {
      return
    }

    map.fitBounds(toLatLngBounds(selectionBounds), 48)
    hasAppliedInitialBounds.current = true
  }, [map, selectionBounds])

  useEffect(() => {
    if (forceMapInitTimeout) {
      return
    }

    if (!hasMapsKey || map) {
      setDidMapInitTimeout(false)
      return
    }

    const timer = window.setTimeout(() => {
      setDidMapInitTimeout(true)
    }, 8_000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [forceMapInitTimeout, hasMapsKey, map])

  useEffect(() => {
    if (forceMapTilesTimeout) {
      return
    }

    if (!hasMapsKey || !map) {
      setDidMapTilesTimeout(false)
      return
    }

    if (hasMapTilesLoaded) {
      setDidMapTilesTimeout(false)
      return
    }

    const timer = window.setTimeout(() => {
      setDidMapTilesTimeout(true)
    }, 8_000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [forceMapTilesTimeout, hasMapTilesLoaded, hasMapsKey, map])

  useEffect(() => {
    if (forceMapLoadError) {
      return
    }

    if (!hasMapsKey || map) {
      setMapLoadErrorMessage(null)
    }
  }, [forceMapLoadError, hasMapsKey, map])

  useEffect(() => {
    if (!map) {
      setHasMapTilesLoaded(false)
    }
  }, [map])

  useEffect(() => {
    if (!projectId || !project?.id || isProjectMissing) {
      return
    }

    let isCancelled = false

    const loadRuns = async () => {
      try {
        const scrapeRuns = await listScrapeRuns(projectId)
        if (isCancelled) {
          return
        }

        setRuns(scrapeRuns)
        const preferredRun = scrapeRuns.find((run) => run.status === 'running' || run.status === 'paused')
          ?? scrapeRuns[0]
          ?? null
        selectRun(preferredRun?.id ?? null)
      }
      catch {
        if (!isCancelled) {
          setErrorMessage('Unable to load scrape runs right now.')
        }
      }
    }

    void loadRuns()

    return () => {
      isCancelled = true
    }
  }, [isProjectMissing, project?.id, projectId, selectRun])

  useEffect(() => {
    if (!activeRunId) {
      setProgress(null)
      setRunTiles([])
      return
    }

    setProgress(null)
    setRunTiles([])

    let isCancelled = false

    const refreshRunSnapshot = async () => {
      try {
        const [status, tiles] = await Promise.all([
          getScrapeStatus(activeRunId),
          listRunTiles(activeRunId),
        ])

        if (isCancelled) {
          return
        }

        setProgress(status)
        setRunTiles(tiles)
      }
      catch {
        if (!isCancelled) {
          setErrorMessage('Unable to refresh run status.')
        }
      }
    }

    void refreshRunSnapshot()

    const unsubscribe = subscribeScrapeProgress(
      activeRunId,
      (nextProgress) => {
        if (isCancelled) {
          return
        }

        setProgress(nextProgress)
      },
      () => {
        if (isCancelled) {
          return
        }

        void refreshRunSnapshot()
      },
    )

    const pollInterval = setInterval(() => {
      void refreshRunSnapshot()
    }, 4_000)

    return () => {
      isCancelled = true
      unsubscribe()
      clearInterval(pollInterval)
    }
  }, [activeRunId])

  const persistBounds = useCallback(
    async (nextBounds: Bounds | null) => {
      if (!projectId) {
        return
      }

      try {
        setIsSaving(true)
        setErrorMessage(null)
        const updatedProject = await updateProject(projectId, {
          bounds: nextBounds ? JSON.stringify(nextBounds) : '',
        })
        setProject(updatedProject)
      }
      catch {
        setErrorMessage('Unable to save bounds. Please try again.')
      }
      finally {
        setIsSaving(false)
      }
    },
    [projectId],
  )

  const handleBoundsPreview = useCallback((nextBounds: Bounds | null) => {
    setSelectionBounds((currentBounds) => {
      if (areBoundsEqual(currentBounds, nextBounds)) {
        return currentBounds
      }

      return nextBounds
    })
  }, [])

  const handleBoundsCommit = useCallback(
    (nextBounds: Bounds | null) => {
      setSelectionBounds(nextBounds)
      void persistBounds(nextBounds)
    },
    [persistBounds],
  )

  const handleSelectArea = useCallback(() => {
    if (!map) {
      return
    }

    const viewportBounds = map.getBounds()
    if (!viewportBounds) {
      return
    }

    const nextBounds: Bounds = {
      sw: {
        lat: viewportBounds.getSouthWest().lat(),
        lng: viewportBounds.getSouthWest().lng(),
      },
      ne: {
        lat: viewportBounds.getNorthEast().lat(),
        lng: viewportBounds.getNorthEast().lng(),
      },
    }

    setSelectionBounds(nextBounds)
    void persistBounds(nextBounds)
  }, [map, persistBounds])

  const handleClearArea = useCallback(() => {
    setSelectionBounds(null)
    void persistBounds(null)
  }, [persistBounds])

  const refreshRuns = useCallback(async (preferredRunId?: string) => {
    if (!projectId) {
      return
    }

    const scrapeRuns = await listScrapeRuns(projectId)
    setRuns(scrapeRuns)
    const selectedRunId = preferredRunId ?? activeRunId
    if (selectedRunId && scrapeRuns.some((run) => run.id === selectedRunId)) {
      if (selectedRunId !== activeRunId) {
        selectRun(selectedRunId)
      }
      return
    }

    const preferredRun = scrapeRuns.find((run) => run.status === 'running' || run.status === 'paused')
      ?? scrapeRuns[0]
      ?? null
    selectRun(preferredRun?.id ?? null)
  }, [activeRunId, projectId, selectRun])

  const handleStartScrape = useCallback(async () => {
    if (!projectId || !selectionBounds) {
      return
    }

    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      setErrorMessage('Enter a query before starting a scrape.')
      return
    }

    try {
      setIsStartingScrape(true)
      setErrorMessage(null)
      const started = await startScrape(projectId, trimmedQuery)
      await refreshRuns(started.scrapeRunId)
    }
    catch {
      setErrorMessage('Unable to start scrape. Please try again.')
    }
    finally {
      setIsStartingScrape(false)
    }
  }, [projectId, query, refreshRuns, selectionBounds])

  const handleTogglePause = useCallback(async () => {
    if (!activeRunId || !progress) {
      return
    }

    try {
      setIsTogglingRun(true)
      setErrorMessage(null)
      if (progress.status === 'running') {
        await pauseScrape(activeRunId)
      }
      else if (progress.status === 'paused') {
        await resumeScrape(activeRunId)
      }
      await refreshRuns()
    }
    catch {
      setErrorMessage('Unable to update run state right now.')
    }
    finally {
      setIsTogglingRun(false)
    }
  }, [activeRunId, progress, refreshRuns])

  if (!projectId) {
    return <main className="setup-page" data-testid="setup-page"><p className="setup-state">Project not found.</p></main>
  }

  if (isProjectMissing) {
    return <main className="setup-page" data-testid="setup-page"><p className="setup-state">Project not found.</p></main>
  }

  if (isLoading) {
    return <main className="setup-page" data-testid="setup-page"><p className="setup-state">Loading setup…</p></main>
  }

  const mapCenter = selectionBounds ? getBoundsCenter(selectionBounds) : FALLBACK_CENTER
  const estimate = selectionBounds ? estimateScrape(selectionBounds) : null
  const isRunActive = progress?.status === 'running' || progress?.status === 'paused'
  const effectiveCompletedTiles = progress
    ? Math.min(progress.tilesTotal, progress.tilesCompleted + progress.tilesSubdivided)
    : 0
  const progressPercent = progress && progress.tilesTotal > 0
    ? Math.round((effectiveCompletedTiles / progress.tilesTotal) * 100)
    : 0
  const estimatedRemaining = progress
    ? estimateRemaining(progress)
    : null

  return (
    <main className="setup-page" data-testid="setup-page">
      <header className="setup-header">
        <p className="setup-breadcrumbs" data-testid="setup-breadcrumbs">
          <span>Projects</span>
          <span>/</span>
          <span>{project?.name ?? 'Project'}</span>
          <span>/</span>
          <span>Setup</span>
        </p>
        <h1>Scrape Setup</h1>
      </header>

      <section className="setup-layout">
        <div
          className="setup-map-panel"
          data-testid="setup-map-panel"
          role="region"
          aria-label="Setup map panel"
        >
          <div
            className="setup-map-shell"
            data-testid="setup-map-shell"
            data-map-tiles-loaded={hasMapTilesLoaded ? 'true' : 'false'}
          >
            {hasMapsKey ? (
              <APIProvider
                apiKey={trimmedMapsKey}
                onError={() => {
                  setMapLoadErrorMessage(MAP_LOAD_ERROR_COPY)
                }}
              >
                <Map
                  defaultCenter={mapCenter}
                  defaultZoom={selectionBounds ? estimateZoom(selectionBounds) : 6}
                  gestureHandling="greedy"
                  style={{ width: '100%', height: '100%' }}
                >
                  <MapBridge onReady={setMap} onTilesLoaded={() => setHasMapTilesLoaded(true)} />
                  <TileOverlayController tiles={runTiles} />
                  <BoundsRectangleController
                    selectedBounds={selectionBounds}
                    onBoundsPreview={handleBoundsPreview}
                    onBoundsCommit={handleBoundsCommit}
                  />
                </Map>
              </APIProvider>
            ) : (
              <div className="setup-map-fallback" data-testid="setup-map-fallback">
                {trimmedMapsKey.length === 0
                  ? 'Set `VITE_GOOGLE_MAPS_API_KEY` to enable map setup.'
                  : 'Replace `VITE_GOOGLE_MAPS_API_KEY` placeholder with a real key to enable map setup.'}
              </div>
            )}

            {mapLoadErrorMessage || didMapInitTimeout || didMapTilesTimeout ? (
              <p className="setup-map-diagnostic" data-testid="setup-map-diagnostic">
                {mapLoadErrorMessage
                  ?? (didMapTilesTimeout
                    ? MAP_TILES_TIMEOUT_COPY
                    : MAP_INIT_TIMEOUT_COPY)}
              </p>
            ) : null}

            {IS_E2E_TEST_MODE ? (
              <pre hidden data-testid="setup-tile-overlay-debug">
                {JSON.stringify(tileOverlayDebugSnapshot)}
              </pre>
            ) : null}
          </div>

          {selectionBounds ? (
            <p className="setup-coordinates-pill" data-testid="setup-coordinates-pill">
              {`SW: ${formatLatitude(selectionBounds.sw.lat)}, ${formatLongitude(selectionBounds.sw.lng)} — NE: ${formatLatitude(selectionBounds.ne.lat)}, ${formatLongitude(selectionBounds.ne.lng)}`}
            </p>
          ) : null}
        </div>

        <aside
          className="setup-sidebar"
          data-testid="setup-controls-panel"
          role="region"
          aria-label="Setup controls panel"
        >
          <h2>Scrape Area</h2>
          <p>Capture the visible map viewport, then fine-tune the rectangle by dragging or resizing corners.</p>

          <div className="setup-actions">
            <button data-testid="setup-select-area-button" type="button" className="setup-select-button" onClick={handleSelectArea}>
              Select Area
            </button>
            <button data-testid="setup-clear-area-button" type="button" className="setup-clear-button" onClick={handleClearArea}>
              Clear
            </button>
          </div>

          <p className="setup-status" data-testid="setup-status-copy">
            {isSaving
              ? 'Saving bounds…'
              : selectionBounds
                ? 'Selection saved to project.'
                : 'No area selected yet.'}
          </p>

          <div className="setup-query-block">
            <label htmlFor="scrape-query">Query</label>
            <div className="setup-query-input-wrap">
              <span aria-hidden="true">⌕</span>
              <input
                data-testid="setup-query-input"
                id="scrape-query"
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search query (e.g. family resort with pool)"
              />
            </div>
            <p className="setup-estimate-badge" data-testid="setup-estimate-badge">
              {estimate
                ? `~${estimate.tiles} tiles · Est. ${estimate.minutes} min`
                : 'Select an area to estimate tiles and timing'}
            </p>
            <button
              data-testid="setup-start-scrape-button"
              type="button"
              className="setup-start-button"
              onClick={() => {
                void handleStartScrape()
              }}
              disabled={!selectionBounds || isStartingScrape}
            >
              {isStartingScrape ? 'Starting…' : 'Start Scrape'}
            </button>
          </div>

          <section className="setup-runs-section" data-testid="setup-runs-section">
            <h3>Previous Runs</h3>
            {runs.length === 0 ? (
              <p className="setup-runs-empty">No runs yet for this project.</p>
            ) : (
              <ul className="setup-runs-list">
                {runs.slice(0, 6).map((run) => (
                  <li key={run.id}>
                    <button
                      data-testid={`setup-run-${run.id}`}
                      type="button"
                      className={`setup-run-item ${activeRunId === run.id ? 'is-active' : ''}`}
                      onClick={() => selectRun(run.id)}
                    >
                      <span className="setup-run-title">{run.query}</span>
                      <span className={`setup-run-status setup-run-status-${run.status}`}>{run.status}</span>
                      <span className="setup-run-metrics">
                        {run.placesFound} places · {run.tilesCompleted}/{run.tilesTotal} tiles
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {progress ? (
            <section className="setup-progress-section" data-testid="setup-progress-section">
              <div className="setup-progress-heading">
                <h3>Progress</h3>
                <span>{progressPercent}%</span>
              </div>

              <div className="setup-progress-track" data-testid="setup-progress-track" role="progressbar" aria-valuenow={progressPercent}>
                <div
                  className={`setup-progress-fill ${progress.status === 'running' ? 'is-running' : ''}`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <p className="setup-progress-stats">
                Tiles: {progress.tilesCompleted}/{progress.tilesTotal} ({progress.tilesSubdivided} subdivided)
              </p>
              <p className="setup-progress-stats">
                Places: {progress.placesFound} ({progress.placesUnique} unique)
              </p>
              <p className="setup-progress-stats">
                Time: {formatDuration(progress.elapsedMs)}
                {estimatedRemaining !== null ? ` · Est. remaining ${formatDuration(estimatedRemaining)}` : ''}
              </p>

              {isRunActive ? (
                <button
                  data-testid="setup-pause-resume-button"
                  type="button"
                  className="setup-pause-button"
                  onClick={() => {
                    void handleTogglePause()
                  }}
                  disabled={isTogglingRun}
                >
                  {progress.status === 'running'
                    ? (isTogglingRun ? 'Pausing…' : 'Pause')
                    : (isTogglingRun ? 'Resuming…' : 'Resume')}
                </button>
              ) : null}
            </section>
          ) : null}

          {errorMessage ? <p className="setup-error" data-testid="setup-error">{errorMessage}</p> : null}
        </aside>
      </section>
    </main>
  )
}

function MapBridge({
  onReady,
  onTilesLoaded,
}: {
  onReady: (map: google.maps.Map) => void
  onTilesLoaded: () => void
}) {
  const map = useMap()

  useEffect(() => {
    if (map) {
      onReady(map)
    }
  }, [map, onReady])

  useEffect(() => {
    if (!map) {
      return
    }

    const listener = map.addListener('tilesloaded', () => {
      onTilesLoaded()
    })

    return () => {
      listener.remove()
    }
  }, [map, onTilesLoaded])

  return null
}

function TileOverlayController({ tiles }: { tiles: ScrapeTile[] }) {
  const map = useMap()
  const rectanglesRef = useRef(new globalThis.Map<string, google.maps.Rectangle>())

  useEffect(() => {
    if (!map) {
      return
    }

    const nextTiles = new globalThis.Map(tiles.map((tile) => [tile.id, tile]))

    for (const [tileId, rectangle] of rectanglesRef.current.entries()) {
      if (nextTiles.has(tileId)) {
        continue
      }

      rectangle.setMap(null)
      rectanglesRef.current.delete(tileId)
    }

    for (const tile of tiles) {
      const bounds = parseBounds(tile.bounds)
      if (!bounds) {
        continue
      }

      const style = tileStyle(tile.status)
      const existing = rectanglesRef.current.get(tile.id)
      if (existing) {
        existing.setOptions({
          ...style,
          bounds: toLatLngBounds(bounds),
          visible: tile.status !== 'subdivided',
        })
        continue
      }

      const rectangle = new google.maps.Rectangle({
        map,
        clickable: false,
        ...style,
        bounds: toLatLngBounds(bounds),
        visible: tile.status !== 'subdivided',
      })
      rectanglesRef.current.set(tile.id, rectangle)
    }
  }, [map, tiles])

  useEffect(() => () => {
    for (const rectangle of rectanglesRef.current.values()) {
      rectangle.setMap(null)
    }
    rectanglesRef.current.clear()
  }, [])

  return null
}

interface BoundsRectangleControllerProps {
  selectedBounds: Bounds | null
  onBoundsPreview: (bounds: Bounds | null) => void
  onBoundsCommit: (bounds: Bounds | null) => void
}

function BoundsRectangleController({
  selectedBounds,
  onBoundsPreview,
  onBoundsCommit,
}: BoundsRectangleControllerProps) {
  const map = useMap()
  const rectangleRef = useRef<google.maps.Rectangle | null>(null)
  const previewCallbackRef = useRef(onBoundsPreview)
  const commitCallbackRef = useRef(onBoundsCommit)

  useEffect(() => {
    previewCallbackRef.current = onBoundsPreview
    commitCallbackRef.current = onBoundsCommit
  }, [onBoundsPreview, onBoundsCommit])

  useEffect(() => {
    if (!map || rectangleRef.current) {
      return
    }

    const rectangle = new google.maps.Rectangle({
      map,
      editable: true,
      draggable: true,
      strokeColor: '#52a0ff',
      strokeOpacity: 1,
      strokeWeight: 2,
      fillColor: '#1d5eb9',
      fillOpacity: 0.18,
      visible: false,
    })

    const publishBounds = () => {
      previewCallbackRef.current(extractBounds(rectangle))
    }

    const commitBounds = () => {
      commitCallbackRef.current(extractBounds(rectangle))
    }

    const listeners = [
      rectangle.addListener('bounds_changed', publishBounds),
      rectangle.addListener('dragend', commitBounds),
      rectangle.addListener('mouseup', commitBounds),
    ]

    rectangleRef.current = rectangle

    return () => {
      listeners.forEach((listener) => listener.remove())
      rectangle.setMap(null)
      rectangleRef.current = null
    }
  }, [map])

  useEffect(() => {
    const rectangle = rectangleRef.current
    if (!rectangle) {
      return
    }

    if (!selectedBounds) {
      rectangle.setVisible(false)
      return
    }

    rectangle.setBounds(toLatLngBounds(selectedBounds))
    rectangle.setVisible(true)
  }, [selectedBounds])

  return null
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
      && parsed.sw.lat < parsed.ne.lat
      && parsed.sw.lng < parsed.ne.lng
    ) {
      return parsed
    }
  }
  catch {
    return null
  }

  return null
}

const extractBounds = (rectangle: google.maps.Rectangle): Bounds | null => {
  const rectangleBounds = rectangle.getBounds()
  if (!rectangleBounds) {
    return null
  }

  return {
    sw: {
      lat: rectangleBounds.getSouthWest().lat(),
      lng: rectangleBounds.getSouthWest().lng(),
    },
    ne: {
      lat: rectangleBounds.getNorthEast().lat(),
      lng: rectangleBounds.getNorthEast().lng(),
    },
  }
}

const toLatLngBounds = (bounds: Bounds): google.maps.LatLngBoundsLiteral => ({
  south: bounds.sw.lat,
  west: bounds.sw.lng,
  north: bounds.ne.lat,
  east: bounds.ne.lng,
})

const areBoundsEqual = (first: Bounds | null, second: Bounds | null): boolean => {
  if (!first || !second) {
    return first === second
  }

  return (
    first.sw.lat === second.sw.lat
    && first.sw.lng === second.sw.lng
    && first.ne.lat === second.ne.lat
    && first.ne.lng === second.ne.lng
  )
}

const getBoundsCenter = (bounds: Bounds): { lat: number; lng: number } => ({
  lat: (bounds.sw.lat + bounds.ne.lat) / 2,
  lng: (bounds.sw.lng + bounds.ne.lng) / 2,
})

const estimateZoom = (bounds: Bounds): number => {
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

const formatLatitude = (value: number): string => `${Math.abs(value).toFixed(4)}°${value >= 0 ? 'N' : 'S'}`

const formatLongitude = (value: number): string => `${Math.abs(value).toFixed(4)}°${value >= 0 ? 'E' : 'W'}`

const estimateScrape = (bounds: Bounds): { tiles: number; minutes: number } => {
  const latSpan = Math.abs(bounds.ne.lat - bounds.sw.lat)
  const lngSpan = Math.abs(bounds.ne.lng - bounds.sw.lng)
  const coarseTileSize = 0.1
  const tiles = Math.max(1, Math.ceil(latSpan / coarseTileSize) * Math.ceil(lngSpan / coarseTileSize))
  const estimatedSeconds = tiles * 28

  return {
    tiles,
    minutes: Math.max(1, Math.round(estimatedSeconds / 60)),
  }
}

const estimateRemaining = (progress: ScrapeProgress): number | null => {
  if (progress.status !== 'running' || progress.tilesCompleted <= 0 || progress.tilesTotal <= progress.tilesCompleted) {
    return null
  }

  const averageTileMs = progress.elapsedMs / progress.tilesCompleted
  const remainingTiles = progress.tilesTotal - progress.tilesCompleted
  return Math.max(0, Math.round(averageTileMs * remainingTiles))
}

const formatDuration = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

const tileStyle = (status: ScrapeTile['status']): Omit<google.maps.RectangleOptions, 'bounds'> => {
  if (status === 'completed') {
    return {
      strokeColor: '#4ad18a',
      strokeOpacity: 0.9,
      strokeWeight: 1,
      fillColor: '#2a9d63',
      fillOpacity: 0.2,
      zIndex: 2,
    }
  }

  if (status === 'running') {
    return {
      strokeColor: '#f0ca53',
      strokeOpacity: 0.95,
      strokeWeight: 2,
      fillColor: '#d6b443',
      fillOpacity: 0.28,
      zIndex: 3,
    }
  }

  return {
    strokeColor: '#71839f',
    strokeOpacity: 0.65,
    strokeWeight: 1,
    fillColor: '#304158',
    fillOpacity: 0.16,
    zIndex: 1,
  }
}

const getForcedMapDiagnostic = (): 'api-key-error' | 'init-timeout' | 'tiles-timeout' | null => {
  if (!IS_E2E_TEST_MODE || typeof window === 'undefined') {
    return null
  }

  const value = new URLSearchParams(window.location.search).get('e2eMapDiagnostic')
  if (value === 'api-key-error' || value === 'init-timeout' || value === 'tiles-timeout') {
    return value
  }

  return null
}
