import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getProject, updateProject, type Project } from '../lib/api'

interface Bounds {
  sw: { lat: number; lng: number }
  ne: { lat: number; lng: number }
}

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
const FALLBACK_CENTER = { lat: 40, lng: 9 }

export function SetupPage() {
  const { projectId } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [selectionBounds, setSelectionBounds] = useState<Bounds | null>(null)
  const [map, setMap] = useState<google.maps.Map | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const hasAppliedInitialBounds = useRef(false)

  const hasMapsKey = Boolean(API_KEY)

  useEffect(() => {
    hasAppliedInitialBounds.current = false
  }, [projectId])

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
        const loadedProject = await getProject(projectId)
        if (isCancelled) {
          return
        }

        setProject(loadedProject)
        setSelectionBounds(parseBounds(loadedProject.bounds))
      }
      catch {
        if (!isCancelled) {
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

  if (!projectId) {
    return <main className="setup-page"><p className="setup-state">Project not found.</p></main>
  }

  if (isLoading) {
    return <main className="setup-page"><p className="setup-state">Loading setup…</p></main>
  }

  const mapCenter = selectionBounds ? getBoundsCenter(selectionBounds) : FALLBACK_CENTER

  return (
    <main className="setup-page">
      <header className="setup-header">
        <p className="setup-breadcrumbs">
          <span>Projects</span>
          <span>/</span>
          <span>{project?.name ?? 'Project'}</span>
          <span>/</span>
          <span>Setup</span>
        </p>
        <h1>Scrape Setup</h1>
      </header>

      <section className="setup-layout">
        <div className="setup-map-panel">
          <div className="setup-map-shell">
            {hasMapsKey ? (
              <APIProvider apiKey={API_KEY ?? ''}>
                <Map
                  defaultCenter={mapCenter}
                  defaultZoom={selectionBounds ? estimateZoom(selectionBounds) : 6}
                  gestureHandling="greedy"
                  style={{ width: '100%', height: '100%' }}
                >
                  <MapBridge onReady={setMap} />
                  <BoundsRectangleController
                    selectedBounds={selectionBounds}
                    onBoundsPreview={handleBoundsPreview}
                    onBoundsCommit={handleBoundsCommit}
                  />
                </Map>
              </APIProvider>
            ) : (
              <div className="setup-map-fallback">Set `VITE_GOOGLE_MAPS_API_KEY` to enable map setup.</div>
            )}
          </div>

          {selectionBounds ? (
            <p className="setup-coordinates-pill">
              {`SW: ${formatLatitude(selectionBounds.sw.lat)}, ${formatLongitude(selectionBounds.sw.lng)} — NE: ${formatLatitude(selectionBounds.ne.lat)}, ${formatLongitude(selectionBounds.ne.lng)}`}
            </p>
          ) : null}
        </div>

        <aside className="setup-sidebar">
          <h2>Scrape Area</h2>
          <p>Capture the visible map viewport, then fine-tune the rectangle by dragging or resizing corners.</p>

          <div className="setup-actions">
            <button type="button" className="setup-select-button" onClick={handleSelectArea}>
              Select Area
            </button>
            <button type="button" className="setup-clear-button" onClick={handleClearArea}>
              Clear
            </button>
          </div>

          <p className="setup-status">
            {isSaving
              ? 'Saving bounds…'
              : selectionBounds
                ? 'Selection saved to project.'
                : 'No area selected yet.'}
          </p>
          {errorMessage ? <p className="setup-error">{errorMessage}</p> : null}
        </aside>
      </section>
    </main>
  )
}

function MapBridge({ onReady }: { onReady: (map: google.maps.Map) => void }) {
  const map = useMap()

  useEffect(() => {
    if (map) {
      onReady(map)
    }
  }, [map, onReady])

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
