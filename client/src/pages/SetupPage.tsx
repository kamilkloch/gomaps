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
  startRescrape,
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
const BOUNDS_COMPARISON_EPSILON = 1e-6

type SetupMapInteractionMode = 'pan' | 'select'
type SetupSelectionCoverageState = 'default' | 'covered'

export function SetupPage() {
  const { projectId } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [selectionBounds, setSelectionBounds] = useState<Bounds | null>(null)
  const [mapInteractionMode, setMapInteractionMode] = useState<SetupMapInteractionMode>('pan')
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
  const refreshRunsRef = useRef<() => void>(() => {})
  const selectionBoundsRef = useRef<Bounds | null>(null)
  const latestPersistRequestIdRef = useRef(0)

  const selectRun = useCallback((runId: string | null) => {
    setActiveRunId(runId)
    // Don't null out progress/tiles here — keep stale data visible until
    // fresh data arrives to avoid an ugly flash when switching runs.
  }, [])

  const forcedMapDiagnostic = getForcedMapDiagnostic()
  const forceMapLoadError = forcedMapDiagnostic === 'api-key-error'
  const forceMapInitTimeout = forcedMapDiagnostic === 'init-timeout'
  const forceMapTilesTimeout = forcedMapDiagnostic === 'tiles-timeout'
  const trimmedMapsKey = API_KEY?.trim() ?? ''
  const hasMapsKey = trimmedMapsKey.length > 0 && !MAPS_KEY_PLACEHOLDERS.has(trimmedMapsKey)
  const activeRun = activeRunId
    ? runs.find((run) => run.id === activeRunId) ?? null
    : null
  const activeRunBounds = parseBounds(activeRun?.bounds ?? null)
  const activeRunMatchesSelection = areBoundsEqual(activeRunBounds, selectionBounds)
  const hasCoveredSelection = activeRun?.status === 'completed' && activeRunMatchesSelection
  const tileOverlayDebugSnapshot = runTiles.map((tile) => {
    const style = tileStyle(tile.status, hasCoveredSelection)
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
    setMapInteractionMode('pan')
  }, [projectId])

  useEffect(() => {
    selectionBoundsRef.current = selectionBounds
  }, [selectionBounds])

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
        const parsedBounds = parseBounds(loadedProject.bounds)
        selectionBoundsRef.current = parsedBounds
        setSelectionBounds(parsedBounds)
      }
      catch (error) {
        if (!isCancelled) {
          if (error instanceof ApiRequestError && error.status === 404) {
            setProject(null)
            selectionBoundsRef.current = null
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

    let isCancelled = false

    let prevStatus: string | null = null

    const handleProgress = (nextProgress: ScrapeProgress) => {
      if (isCancelled) {
        return
      }

      setProgress(nextProgress)

      // Refresh the run list when status transitions to a terminal state
      // so run cards stay in sync with the live progress.
      const isTerminal = nextProgress.status === 'completed'
        || nextProgress.status === 'failed'
      if (isTerminal && prevStatus && prevStatus !== nextProgress.status) {
        refreshRunsRef.current()
      }
      prevStatus = nextProgress.status
    }

    const refreshRunSnapshot = async () => {
      try {
        const [status, tiles] = await Promise.all([
          getScrapeStatus(activeRunId),
          listRunTiles(activeRunId),
        ])

        if (isCancelled) {
          return
        }

        handleProgress(status)
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
      handleProgress,
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

  // Client-side 1s timer to smoothly interpolate elapsed time between
  // server SSE/poll updates so the clock doesn't jump every 4s.
  const serverElapsedRef = useRef<{ ms: number; at: number } | null>(null)
  const [clientElapsedMs, setClientElapsedMs] = useState<number | null>(null)

  useEffect(() => {
    if (progress) {
      serverElapsedRef.current = { ms: progress.elapsedMs, at: Date.now() }
      setClientElapsedMs(progress.elapsedMs)
    } else {
      serverElapsedRef.current = null
      setClientElapsedMs(null)
    }
  }, [progress])

  useEffect(() => {
    const isActive = progress?.status === 'running' || progress?.status === 'paused'
    if (!isActive || !serverElapsedRef.current) {
      return
    }

    const tick = setInterval(() => {
      const ref = serverElapsedRef.current
      if (ref) {
        setClientElapsedMs(ref.ms + (Date.now() - ref.at))
      }
    }, 1_000)

    return () => clearInterval(tick)
  }, [progress?.status])

  const persistBounds = useCallback(
    async (nextBounds: Bounds | null) => {
      if (!projectId) {
        return
      }

      const requestId = latestPersistRequestIdRef.current + 1
      latestPersistRequestIdRef.current = requestId

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
        if (latestPersistRequestIdRef.current === requestId) {
          setIsSaving(false)
        }
      }
    },
    [projectId],
  )

  const handleBoundsPreview = useCallback((_nextBounds: Bounds | null) => {}, [])

  const handleBoundsCommit = useCallback(
    (nextBounds: Bounds | null) => {
      if (areBoundsEqual(selectionBoundsRef.current, nextBounds)) {
        return
      }
      selectionBoundsRef.current = nextBounds
      setSelectionBounds(nextBounds)
      void persistBounds(nextBounds)
    },
    [persistBounds],
  )

  const handleClearArea = useCallback(() => {
    if (!selectionBoundsRef.current) {
      return
    }
    selectionBoundsRef.current = null
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

  useEffect(() => {
    refreshRunsRef.current = () => { void refreshRuns() }
  }, [refreshRuns])

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
      const started = await startScrape(
        projectId,
        trimmedQuery,
        JSON.stringify(selectionBounds),
      )
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

  const handleRescrape = useCallback(async () => {
    if (!projectId) {
      return
    }

    try {
      setIsStartingScrape(true)
      setErrorMessage(null)
      const started = await startRescrape(projectId)
      await refreshRuns(started.scrapeRunId)
    }
    catch {
      setErrorMessage('Unable to refresh project place data right now.')
    }
    finally {
      setIsStartingScrape(false)
    }
  }, [projectId, refreshRuns])

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
  const selectionCoverageState: SetupSelectionCoverageState =
    hasCoveredSelection
      ? 'covered'
      : 'default'
  const isRunActive = progress?.status === 'running' || progress?.status === 'paused'
  const effectiveCompletedTiles = progress
    ? Math.min(progress.tilesTotal, progress.tilesCompleted + progress.tilesSubdivided)
    : 0
  const rawPercent = progress && progress.tilesTotal > 0
    ? Math.round((effectiveCompletedTiles / progress.tilesTotal) * 100)
    : 0
  // Cap at 99% while the run is still active — the engine may still be
  // persisting place details after all tiles report "completed".
  const progressPercent = isRunActive ? Math.min(rawPercent, 99) : rawPercent
  const estimatedRemaining = progress
    ? estimateRemaining(progress)
    : null
  const displayElapsedMs = clientElapsedMs ?? progress?.elapsedMs ?? 0
  const statusCopy = selectionBounds
    ? mapInteractionMode === 'select'
      ? 'Selection saved to project. Select mode: drag on map to redraw, or drag handles to fine-tune.'
      : 'Selection saved to project. Pan mode: move/zoom map. Switch to Select mode to adjust area.'
    : mapInteractionMode === 'select'
      ? 'No area selected yet. Select mode: drag on map to draw your scrape area.'
      : 'No area selected yet. Pan mode: move/zoom map, then switch to Select mode to draw an area.'

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
            className={`setup-map-shell ${mapInteractionMode === 'select' ? 'is-select-mode' : 'is-pan-mode'}`}
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
                  gestureHandling={mapInteractionMode === 'select' ? 'none' : 'greedy'}
                  draggable={mapInteractionMode !== 'select'}
                  draggableCursor={mapInteractionMode === 'select' ? 'crosshair' : undefined}
                  draggingCursor={mapInteractionMode === 'select' ? 'crosshair' : undefined}
                  style={{ width: '100%', height: '100%' }}
                >
                  <MapBridge onReady={setMap} onTilesLoaded={() => setHasMapTilesLoaded(true)} />
                  <TileOverlayController
                    tiles={runTiles}
                    deemphasizeCompletedTiles={hasCoveredSelection}
                  />
                  <RunBoundsOverlayController
                    bounds={activeRunMatchesSelection ? null : activeRunBounds}
                  />
                  <BoundsRectangleController
                    selectedBounds={selectionBounds}
                    coverageState={selectionCoverageState}
                    mapInteractionMode={mapInteractionMode}
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

            <div className="setup-map-overlay-controls" data-testid="setup-map-overlay-controls">
              <div className="setup-map-mode-toggle" role="group" aria-label="Map interaction mode">
                <button
                  data-testid="setup-map-pan-mode-button"
                  type="button"
                  className={`setup-map-mode-button ${mapInteractionMode === 'pan' ? 'is-active' : ''}`}
                  onClick={() => setMapInteractionMode('pan')}
                  disabled={!hasMapsKey}
                >
                  Pan
                </button>
                <button
                  data-testid="setup-select-area-button"
                  type="button"
                  className={`setup-map-mode-button ${mapInteractionMode === 'select' ? 'is-active' : ''}`}
                  onClick={() => setMapInteractionMode('select')}
                  disabled={!hasMapsKey}
                >
                  Select
                </button>
              </div>
              <button
                data-testid="setup-clear-area-button"
                type="button"
                className="setup-map-reset-button"
                onClick={handleClearArea}
                disabled={!selectionBounds}
              >
                Reset area
              </button>
            </div>
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
          <p>Use map controls to switch between Pan and Select mode. In Select mode, drag to draw a new rectangle or adjust the existing one.</p>

          <p className="setup-status" data-testid="setup-status-copy">
            <span data-testid="setup-status-primary">{statusCopy}</span>
            <span
              data-testid="setup-status-saving"
              className={`setup-status-saving ${isSaving ? 'is-visible' : ''}`}
              aria-live="polite"
              role="status"
            >
              {isSaving ? 'Saving bounds…' : ''}
            </span>
          </p>
          {activeRun ? (
            <p className="setup-run-footprint" data-testid="setup-run-footprint">
              {activeRunBounds
                ? activeRunMatchesSelection
                  ? 'Selected run footprint matches the current selection. The thick green border marks the scraped area; the lighter inner grid only shows tile subdivisions.'
                  : 'Selected run footprint is marked with the green outline. It differs from the current blue selection.'
                : 'Selected run does not have recorded bounds, so only the tile grid can be shown.'}
            </p>
          ) : null}

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
            <button
              data-testid="setup-rescrape-button"
              type="button"
              className="setup-clear-button"
              onClick={() => {
                void handleRescrape()
              }}
              disabled={isStartingScrape}
            >
              {isStartingScrape ? 'Refreshing…' : 'Refresh Data'}
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
                  className={`setup-progress-fill${progress.status === 'running' ? ' is-running' : ''}${progress.status === 'completed' ? ' is-completed' : ''}`}
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
                Time: {formatDuration(displayElapsedMs)}
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

function TileOverlayController({
  tiles,
  deemphasizeCompletedTiles,
}: {
  tiles: ScrapeTile[]
  deemphasizeCompletedTiles: boolean
}) {
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

      const style = tileStyle(tile.status, deemphasizeCompletedTiles)
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
  }, [deemphasizeCompletedTiles, map, tiles])

  useEffect(() => () => {
    for (const rectangle of rectanglesRef.current.values()) {
      rectangle.setMap(null)
    }
    rectanglesRef.current.clear()
  }, [])

  return null
}

function RunBoundsOverlayController({ bounds }: { bounds: Bounds | null }) {
  const map = useMap()
  const rectangleRef = useRef<google.maps.Rectangle | null>(null)

  useEffect(() => {
    if (!map) {
      return
    }

    if (!rectangleRef.current) {
      rectangleRef.current = new google.maps.Rectangle({
        map,
        clickable: false,
        strokeColor: '#53e3a6',
        strokeOpacity: 0.96,
        strokeWeight: 3,
        fillOpacity: 0,
        zIndex: 5,
        visible: false,
      })
    }

    const rectangle = rectangleRef.current
    if (!bounds) {
      rectangle.setVisible(false)
      return
    }

    rectangle.setOptions({
      bounds: toLatLngBounds(bounds),
      visible: true,
    })
  }, [bounds, map])

  useEffect(() => () => {
    rectangleRef.current?.setMap(null)
    rectangleRef.current = null
  }, [])

  return null
}

interface BoundsRectangleControllerProps {
  selectedBounds: Bounds | null
  coverageState: SetupSelectionCoverageState
  mapInteractionMode: SetupMapInteractionMode
  onBoundsPreview: (bounds: Bounds | null) => void
  onBoundsCommit: (bounds: Bounds | null) => void
}

function BoundsRectangleController({
  selectedBounds,
  coverageState,
  mapInteractionMode,
  onBoundsPreview,
  onBoundsCommit,
}: BoundsRectangleControllerProps) {
  const map = useMap()
  const rectangleRef = useRef<google.maps.Rectangle | null>(null)
  const mapInteractionModeRef = useRef(mapInteractionMode)
  const drawStartRef = useRef<google.maps.LatLng | null>(null)
  const hasDrawMovedRef = useRef(false)
  const suppressNextRectangleMouseUpCommitRef = useRef(false)
  const suppressNextRectangleDragEndCommitRef = useRef(false)
  const lastCommittedBoundsRef = useRef<Bounds | null>(null)
  const previewCallbackRef = useRef(onBoundsPreview)
  const commitCallbackRef = useRef(onBoundsCommit)

  useEffect(() => {
    previewCallbackRef.current = onBoundsPreview
    commitCallbackRef.current = onBoundsCommit
  }, [onBoundsPreview, onBoundsCommit])

  useEffect(() => {
    mapInteractionModeRef.current = mapInteractionMode
  }, [mapInteractionMode])

  useEffect(() => {
    if (!map || rectangleRef.current) {
      return
    }

    const rectangle = new google.maps.Rectangle({
      map,
      editable: true,
      draggable: true,
      ...selectionRectangleStyle(coverageState),
      visible: false,
    })

    const syncRectangleEditability = () => {
      const isSelectMode = mapInteractionModeRef.current === 'select'
      rectangle.setEditable(isSelectMode)
      rectangle.setDraggable(isSelectMode)
    }

    const resetDrawState = () => {
      drawStartRef.current = null
      hasDrawMovedRef.current = false
      syncRectangleEditability()
    }

    const updateRectangleFromDrag = (start: google.maps.LatLng, end: google.maps.LatLng): Bounds | null => {
      const nextBounds = boundsFromPoints(
        { lat: start.lat(), lng: start.lng() },
        { lat: end.lat(), lng: end.lng() },
      )
      if (!nextBounds) {
        return null
      }

      rectangle.setBounds(toLatLngBounds(nextBounds))
      rectangle.setVisible(true)
      previewCallbackRef.current(nextBounds)
      return nextBounds
    }

    const commitBoundsIfChanged = (nextBounds: Bounds | null): boolean => {
      if (!nextBounds) {
        return false
      }

      if (areBoundsEqual(lastCommittedBoundsRef.current, nextBounds)) {
        return false
      }

      lastCommittedBoundsRef.current = nextBounds
      commitCallbackRef.current(nextBounds)
      return true
    }

    const beginDraw = (event: google.maps.MapMouseEvent) => {
      if (mapInteractionModeRef.current !== 'select' || !event.latLng) {
        return
      }

      const rectangleBounds = rectangle.getBounds()
      if (
        rectangle.getVisible()
        && rectangleBounds
        && rectangleBounds.contains(event.latLng)
      ) {
        return
      }

      drawStartRef.current = event.latLng
      hasDrawMovedRef.current = false
      rectangle.setEditable(false)
      rectangle.setDraggable(false)
    }

    const continueDraw = (event: google.maps.MapMouseEvent) => {
      const start = drawStartRef.current
      if (mapInteractionModeRef.current !== 'select' || !start || !event.latLng) {
        return
      }

      const nextBounds = updateRectangleFromDrag(start, event.latLng)
      if (nextBounds) {
        hasDrawMovedRef.current = true
      }
    }

    const finishDraw = (event: google.maps.MapMouseEvent) => {
      const start = drawStartRef.current
      if (mapInteractionModeRef.current !== 'select' || !start) {
        resetDrawState()
        return
      }

      let committedFromMouseUp = false
      let nextBoundsFromMouseUp: Bounds | null = null
      if (event.latLng) {
        nextBoundsFromMouseUp = updateRectangleFromDrag(start, event.latLng)
        if (nextBoundsFromMouseUp && commitBoundsIfChanged(nextBoundsFromMouseUp)) {
          committedFromMouseUp = true
        }
      }

      if (!committedFromMouseUp && hasDrawMovedRef.current) {
        const currentBounds = extractBounds(rectangle)
        if (commitBoundsIfChanged(currentBounds)) {
          committedFromMouseUp = true
        }
      }

      if (committedFromMouseUp) {
        suppressNextRectangleMouseUpCommitRef.current = true
      }

      resetDrawState()
    }

    const finalizeDrawFromGlobalMouseUp = () => {
      if (!drawStartRef.current) {
        return
      }

      if (hasDrawMovedRef.current) {
        const currentBounds = extractBounds(rectangle)
        if (commitBoundsIfChanged(currentBounds)) {
          suppressNextRectangleMouseUpCommitRef.current = true
        }
      }

      resetDrawState()
    }

    const handleRectangleMouseUp = (event: google.maps.MapMouseEvent) => {
      if (suppressNextRectangleMouseUpCommitRef.current) {
        suppressNextRectangleMouseUpCommitRef.current = false
        return
      }

      if (drawStartRef.current) {
        finishDraw(event)
        return
      }

      const currentBounds = extractBounds(rectangle)
      if (commitBoundsIfChanged(currentBounds)) {
        suppressNextRectangleDragEndCommitRef.current = true
      }
    }

    const handleRectangleDragEnd = () => {
      if (suppressNextRectangleDragEndCommitRef.current) {
        suppressNextRectangleDragEndCommitRef.current = false
        resetDrawState()
        return
      }

      const currentBounds = extractBounds(rectangle)
      if (commitBoundsIfChanged(currentBounds)) {
        suppressNextRectangleMouseUpCommitRef.current = true
      }
      resetDrawState()
    }

    const listeners = [
      map.addListener('mousedown', beginDraw),
      map.addListener('mousemove', continueDraw),
      map.addListener('mouseup', finishDraw),
      rectangle.addListener('dragend', handleRectangleDragEnd),
      rectangle.addListener('mouseup', handleRectangleMouseUp),
    ]
    window.addEventListener('mouseup', finalizeDrawFromGlobalMouseUp)

    rectangleRef.current = rectangle

    return () => {
      listeners.forEach((listener) => listener.remove())
      window.removeEventListener('mouseup', finalizeDrawFromGlobalMouseUp)
      rectangle.setMap(null)
      rectangleRef.current = null
    }
  }, [map])

  useEffect(() => {
    const rectangle = rectangleRef.current
    if (!rectangle) {
      return
    }

    const isSelectMode = mapInteractionMode === 'select'
    rectangle.setEditable(isSelectMode)
    rectangle.setDraggable(isSelectMode)

    if (!selectedBounds) {
      rectangle.setVisible(false)
      return
    }

    rectangle.setOptions({
      ...selectionRectangleStyle(coverageState),
      bounds: toLatLngBounds(selectedBounds),
    })
    rectangle.setVisible(true)
  }, [coverageState, mapInteractionMode, selectedBounds])

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
    areNumbersClose(first.sw.lat, second.sw.lat)
    && areNumbersClose(first.sw.lng, second.sw.lng)
    && areNumbersClose(first.ne.lat, second.ne.lat)
    && areNumbersClose(first.ne.lng, second.ne.lng)
  )
}

const areNumbersClose = (first: number, second: number): boolean =>
  Math.abs(first - second) <= BOUNDS_COMPARISON_EPSILON

const boundsFromPoints = (
  first: { lat: number; lng: number },
  second: { lat: number; lng: number },
): Bounds | null => {
  const south = Math.min(first.lat, second.lat)
  const north = Math.max(first.lat, second.lat)
  const west = Math.min(first.lng, second.lng)
  const east = Math.max(first.lng, second.lng)

  if (south === north || west === east) {
    return null
  }

  return {
    sw: { lat: south, lng: west },
    ne: { lat: north, lng: east },
  }
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

const tileStyle = (
  status: ScrapeTile['status'],
  deemphasizeCompletedTiles = false,
): Omit<google.maps.RectangleOptions, 'bounds'> => {
  if (status === 'completed') {
    if (deemphasizeCompletedTiles) {
      return {
        strokeColor: '#2f8e61',
        strokeOpacity: 0.55,
        strokeWeight: 1,
        fillColor: '#2f8e61',
        fillOpacity: 0.04,
        zIndex: 2,
      }
    }

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

const selectionRectangleStyle = (
  coverageState: SetupSelectionCoverageState,
): Omit<google.maps.RectangleOptions, 'bounds'> => {
  if (coverageState === 'covered') {
    return {
      strokeColor: '#7dffbf',
      strokeOpacity: 1,
      strokeWeight: 5,
      fillColor: '#158f62',
      fillOpacity: 0.14,
      zIndex: 7,
    }
  }

  return {
    strokeColor: '#52a0ff',
    strokeOpacity: 1,
    strokeWeight: 2,
    fillColor: '#1d5eb9',
    fillOpacity: 0.18,
    zIndex: 6,
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
