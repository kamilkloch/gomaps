import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps'
import { MarkerClusterer } from '@googlemaps/markerclusterer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getProject, listPlaces, listProjects, type Place, type Project } from '../lib/api'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
const FALLBACK_CENTER = { lat: 40, lng: 9 }

export function ExplorerPage() {
  const { projectId: routeProjectId } = useParams()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(routeProjectId ?? null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [places, setPlaces] = useState<Place[]>([])
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')
  const [isLoadingProjects, setIsLoadingProjects] = useState(true)
  const [isLoadingPlaces, setIsLoadingPlaces] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const hasMapsKey = Boolean(API_KEY)

  useEffect(() => {
    let isCancelled = false

    const loadProjects = async () => {
      try {
        setIsLoadingProjects(true)
        setErrorMessage(null)
        const loadedProjects = await listProjects()
        if (isCancelled) {
          return
        }

        setProjects(loadedProjects)
        const nextProjectId = routeProjectId
          ?? selectedProjectId
          ?? loadedProjects[0]?.id
          ?? null
        setSelectedProjectId(nextProjectId)
      }
      catch {
        if (!isCancelled) {
          setErrorMessage('Unable to load projects right now.')
        }
      }
      finally {
        if (!isCancelled) {
          setIsLoadingProjects(false)
        }
      }
    }

    void loadProjects()

    return () => {
      isCancelled = true
    }
  }, [routeProjectId, selectedProjectId])

  useEffect(() => {
    if (!routeProjectId) {
      return
    }

    setSelectedProjectId(routeProjectId)
  }, [routeProjectId])

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedProject(null)
      setPlaces([])
      return
    }

    let isCancelled = false

    const loadProjectAndPlaces = async () => {
      try {
        setIsLoadingPlaces(true)
        setErrorMessage(null)
        const [project, projectPlaces] = await Promise.all([
          getProject(selectedProjectId),
          listPlaces(selectedProjectId),
        ])

        if (isCancelled) {
          return
        }

        setSelectedProject(project)
        setPlaces(projectPlaces)
        setSelectedPlaceId((current) =>
          current && projectPlaces.some((place) => place.id === current)
            ? current
            : projectPlaces[0]?.id ?? null)
      }
      catch {
        if (!isCancelled) {
          setErrorMessage('Unable to load explorer data right now.')
        }
      }
      finally {
        if (!isCancelled) {
          setIsLoadingPlaces(false)
        }
      }
    }

    void loadProjectAndPlaces()

    return () => {
      isCancelled = true
    }
  }, [selectedProjectId])

  const filteredPlaces = useMemo(() => {
    const trimmedSearch = searchText.trim().toLowerCase()
    if (!trimmedSearch) {
      return places
    }

    return places.filter((place) =>
      [place.name, place.address ?? '', place.category ?? '']
        .join(' ')
        .toLowerCase()
        .includes(trimmedSearch)
    )
  }, [places, searchText])

  const selectedPlace = useMemo(
    () => filteredPlaces.find((place) => place.id === selectedPlaceId) ?? null,
    [filteredPlaces, selectedPlaceId],
  )

  const mapCenter = selectedPlace
    ? { lat: selectedPlace.lat, lng: selectedPlace.lng }
    : getProjectCenter(selectedProject?.bounds) ?? FALLBACK_CENTER

  const handleProjectChange = useCallback((nextProjectId: string) => {
    setSelectedProjectId(nextProjectId)
    navigate(`/projects/${nextProjectId}/explorer`)
  }, [navigate])

  return (
    <main className="explorer-page" data-testid="explorer-page">
      <header className="explorer-header">
        <div className="explorer-project-switcher">
          <label htmlFor="explorer-project">Project</label>
          <select
            data-testid="explorer-project-select"
            id="explorer-project"
            value={selectedProjectId ?? ''}
            onChange={(event) => handleProjectChange(event.target.value)}
            disabled={isLoadingProjects || projects.length === 0}
          >
            {projects.length === 0 ? <option value="">No projects</option> : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </div>

        <div className="explorer-search-wrap">
          <input
            data-testid="explorer-search-input"
            type="search"
            placeholder="Search places"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>

        <button type="button" className="explorer-filters-button">
          Filters
          <span>0</span>
        </button>
      </header>

      {errorMessage ? <p className="explorer-error" data-testid="explorer-error">{errorMessage}</p> : null}

      <section className="explorer-layout">
        <section className="explorer-main-grid">
          <div className="explorer-map-panel" data-testid="explorer-map-panel">
            {hasMapsKey ? (
              <APIProvider apiKey={API_KEY ?? ''}>
                <Map
                  center={mapCenter}
                  defaultZoom={8}
                  gestureHandling="greedy"
                  style={{ width: '100%', height: '100%' }}
                >
                  <MapStyleController />
                  <PlaceMarkerController
                    places={filteredPlaces}
                    selectedPlaceId={selectedPlaceId}
                    onSelectPlace={setSelectedPlaceId}
                  />
                </Map>
              </APIProvider>
            ) : (
              <div className="explorer-map-fallback" data-testid="explorer-map-fallback">Set `VITE_GOOGLE_MAPS_API_KEY` to view Explorer map.</div>
            )}
          </div>

          <aside className="explorer-detail-panel" data-testid="explorer-detail-panel">
            {selectedPlace ? (
              <>
                <p className="explorer-detail-kicker">Selected Place</p>
                <h2 data-testid="explorer-detail-name">{selectedPlace.name}</h2>
                <p>{selectedPlace.category ?? 'Uncategorized'} · {selectedPlace.rating?.toFixed(1) ?? 'N/A'}★</p>
                <p>{selectedPlace.address ?? 'No address available'}</p>
              </>
            ) : (
              <p className="explorer-placeholder">Select a marker to inspect place details.</p>
            )}
          </aside>

          <section className="explorer-table-panel" data-testid="explorer-table-panel">
            <div className="explorer-table-toolbar">
              <span data-testid="explorer-table-count">{isLoadingPlaces ? 'Loading places…' : `${filteredPlaces.length} places`}</span>
            </div>

            <div className="explorer-table-scroll">
              <table data-testid="explorer-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Rating</th>
                    <th>Reviews</th>
                    <th>Website</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPlaces.slice(0, 120).map((place) => (
                    <tr
                      key={place.id}
                      data-testid={`explorer-row-${place.id}`}
                      data-selected={place.id === selectedPlaceId ? 'true' : 'false'}
                      className={place.id === selectedPlaceId ? 'is-selected' : ''}
                      onClick={() => setSelectedPlaceId(place.id)}
                    >
                      <td>{place.name}</td>
                      <td>{place.category ?? '—'}</td>
                      <td>{place.rating?.toFixed(1) ?? '—'}</td>
                      <td>{place.reviewCount ?? '—'}</td>
                      <td>{place.websiteType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <aside className="explorer-filter-sidebar">
          <h2>Filters</h2>
          <p>Active filters will appear here in US-018.</p>
        </aside>
      </section>
    </main>
  )
}

interface PlaceMarkerControllerProps {
  places: Place[]
  selectedPlaceId: string | null
  onSelectPlace: (placeId: string | null) => void
}

function PlaceMarkerController({ places, selectedPlaceId, onSelectPlace }: PlaceMarkerControllerProps) {
  const map = useMap()
  const markersRef = useRef(new globalThis.Map<string, google.maps.Marker>())
  const clustererRef = useRef<MarkerClusterer | null>(null)
  const selectionCircleRef = useRef<google.maps.Circle | null>(null)
  const onSelectRef = useRef(onSelectPlace)
  const placesById = useMemo(() => new globalThis.Map(places.map((place) => [place.id, place])), [places])

  useEffect(() => {
    onSelectRef.current = onSelectPlace
  }, [onSelectPlace])

  useEffect(() => {
    if (!map || clustererRef.current) {
      return
    }

    const clusterer = new MarkerClusterer({
      map,
      renderer: {
        render: ({ count, position }) =>
          new google.maps.Marker({
            position,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              fillColor: '#2f86f6',
              fillOpacity: 0.9,
              strokeColor: '#dcecff',
              strokeWeight: 2,
              scale: Math.min(30, Math.max(18, count / 3 + 12)),
            },
            label: {
              text: String(count),
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: '700',
            },
            zIndex: 1100,
          }),
      },
    })
    clustererRef.current = clusterer

    const clickListener = map.addListener('click', () => {
      onSelectRef.current(null)
    })

    return () => {
      clickListener.remove()
      clusterer.clearMarkers()
      clusterer.setMap(null)
      clustererRef.current = null
    }
  }, [map])

  useEffect(() => {
    if (!map || !clustererRef.current) {
      return
    }

    const nextIds = new Set(places.map((place) => place.id))

    for (const [placeId, marker] of markersRef.current.entries()) {
      if (nextIds.has(placeId)) {
        continue
      }

      marker.setMap(null)
      markersRef.current.delete(placeId)
    }

    for (const place of places) {
      const icon = markerIcon(place.rating, place.id === selectedPlaceId)
      const existing = markersRef.current.get(place.id)
      if (existing) {
        existing.setPosition({ lat: place.lat, lng: place.lng })
        existing.setIcon(icon)
        existing.setZIndex(place.id === selectedPlaceId ? 1050 : 1000)
        continue
      }

      const marker = new google.maps.Marker({
        position: { lat: place.lat, lng: place.lng },
        icon,
        title: place.name,
        zIndex: place.id === selectedPlaceId ? 1050 : 1000,
      })

      marker.addListener('click', () => {
        onSelectRef.current(place.id)
      })

      markersRef.current.set(place.id, marker)
    }

    clustererRef.current.clearMarkers()
    clustererRef.current.addMarkers(Array.from(markersRef.current.values()))
  }, [map, places, selectedPlaceId])

  useEffect(() => {
    if (!map) {
      return
    }

    const selectedPlace = selectedPlaceId ? placesById.get(selectedPlaceId) ?? null : null
    if (!selectedPlace) {
      if (selectionCircleRef.current) {
        selectionCircleRef.current.setMap(null)
        selectionCircleRef.current = null
      }
      return
    }

    const circle = selectionCircleRef.current
      ?? new google.maps.Circle({
        map,
        strokeColor: '#6bf2ad',
        strokeOpacity: 0.85,
        strokeWeight: 2,
        fillColor: '#58d39a',
        fillOpacity: 0.22,
      })

    selectionCircleRef.current = circle
    circle.setCenter({ lat: selectedPlace.lat, lng: selectedPlace.lng })
    circle.setRadius(150)

    let phase = 0
    const pulseTimer = window.setInterval(() => {
      phase += 0.22
      const radius = 150 + (Math.sin(phase) * 35)
      const fillOpacity = 0.2 + (Math.sin(phase) * 0.05)
      circle.setRadius(radius)
      circle.setOptions({ fillOpacity: Math.max(0.1, fillOpacity) })
    }, 120)

    return () => {
      clearInterval(pulseTimer)
    }
  }, [map, placesById, selectedPlaceId])

  useEffect(() => () => {
    for (const marker of markersRef.current.values()) {
      marker.setMap(null)
    }
    markersRef.current.clear()
    if (selectionCircleRef.current) {
      selectionCircleRef.current.setMap(null)
      selectionCircleRef.current = null
    }
  }, [])

  return null
}

function MapStyleController() {
  const map = useMap()

  useEffect(() => {
    if (!map) {
      return
    }

    map.setOptions({
      styles: DARK_MAP_STYLES,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
    })
  }, [map])

  return null
}

const markerIcon = (rating: number | null, isSelected: boolean): google.maps.Symbol => {
  const color = ratingColor(rating)

  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: isSelected ? '#cbffe6' : '#e9f1ff',
    strokeOpacity: 1,
    strokeWeight: isSelected ? 3 : 2,
    scale: isSelected ? 9 : 6,
  }
}

const ratingColor = (rating: number | null): string => {
  if (rating === null) {
    return '#f2c862'
  }

  if (rating < 3.5) {
    return '#e35d63'
  }

  if (rating <= 4.2) {
    return '#f0ca53'
  }

  return '#5dd58b'
}

const getProjectCenter = (boundsRaw: string | null | undefined): { lat: number; lng: number } | null => {
  if (!boundsRaw) {
    return null
  }

  try {
    const bounds = JSON.parse(boundsRaw) as {
      sw: { lat: number; lng: number }
      ne: { lat: number; lng: number }
    }
    if (
      Number.isFinite(bounds.sw.lat)
      && Number.isFinite(bounds.sw.lng)
      && Number.isFinite(bounds.ne.lat)
      && Number.isFinite(bounds.ne.lng)
    ) {
      return {
        lat: (bounds.sw.lat + bounds.ne.lat) / 2,
        lng: (bounds.sw.lng + bounds.ne.lng) / 2,
      }
    }
  }
  catch {
    return null
  }

  return null
}

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#0f1a2b' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0f1a2b' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#99b2d1' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#c3d7ef' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#7a93b8' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#163044' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1d2d47' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#15233a' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8aa6ca' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#274875' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1a3555' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b2236' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#6d8bb4' }] },
]
