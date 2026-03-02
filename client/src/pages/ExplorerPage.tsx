import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps'
import { MarkerClusterer, MarkerClustererEvents } from '@googlemaps/markerclusterer'
import Fuse from 'fuse.js'
import type { UIEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getProject,
  listPlaceReviews,
  listPlaces,
  listProjects,
  type Place,
  type PlaceReview,
  type Project,
} from '../lib/api'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
const IS_E2E_TEST_MODE = import.meta.env.VITE_E2E_TEST_MODE === '1'
const FALLBACK_CENTER = { lat: 40, lng: 9 }
const TABLE_ROW_HEIGHT = 44
const TABLE_OVERSCAN = 10
const REVIEW_SNIPPET_LENGTH = 220

type SortKey =
  | 'name'
  | 'category'
  | 'rating'
  | 'reviewCount'
  | 'priceLevel'
  | 'websiteType'
  | 'address'

interface SortState {
  key: SortKey
  direction: 'asc' | 'desc'
}

interface MarkerDebugEntry {
  placeId: string
  rating: number | null
  fillColor: string
}

interface ClusterDebugSnapshot {
  totalClusters: number
  groupedClusterCount: number
  clusterLabels: string[]
  maxClusterSize: number
}

interface SelectionCircleDebugSnapshot {
  visible: boolean
  placeId: string | null
  center: { lat: number; lng: number } | null
  radius: number | null
}

interface SearchablePlaceEntry {
  place: Place
  name: string
  address: string
  category: string
  amenities: string[]
  reviews: string
}

interface ExplorerE2EMapDebugController {
  clickMarker: (placeId: string) => boolean
  clickMap: () => boolean
  setZoom: (zoom: number) => boolean
}

const EMPTY_CLUSTER_DEBUG_SNAPSHOT: ClusterDebugSnapshot = {
  totalClusters: 0,
  groupedClusterCount: 0,
  clusterLabels: [],
  maxClusterSize: 0,
}

const EMPTY_SELECTION_CIRCLE_DEBUG_SNAPSHOT: SelectionCircleDebugSnapshot = {
  visible: false,
  placeId: null,
  center: null,
  radius: null,
}

declare global {
  interface Window {
    __gomapsExplorerDebug?: ExplorerE2EMapDebugController
  }
}

export function ExplorerPage() {
  const { projectId: routeProjectId } = useParams()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(routeProjectId ?? null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [places, setPlaces] = useState<Place[]>([])
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearchText, setDebouncedSearchText] = useState('')
  const [tableFilterText, setTableFilterText] = useState('')
  const [sortState, setSortState] = useState<SortState>({ key: 'rating', direction: 'desc' })
  const [favoritePlaceIds, setFavoritePlaceIds] = useState<Set<string>>(new Set())
  const [reviewsByPlaceId, setReviewsByPlaceId] = useState<Record<string, PlaceReview[]>>({})
  const [isLoadingSelectedReviews, setIsLoadingSelectedReviews] = useState(false)
  const [selectedReviewsError, setSelectedReviewsError] = useState<string | null>(null)
  const [isOpeningHoursExpanded, setIsOpeningHoursExpanded] = useState(true)
  const [markerDebugEntries, setMarkerDebugEntries] = useState<MarkerDebugEntry[]>([])
  const [clusterDebugSnapshot, setClusterDebugSnapshot] = useState<ClusterDebugSnapshot>(EMPTY_CLUSTER_DEBUG_SNAPSHOT)
  const [selectionCircleDebugSnapshot, setSelectionCircleDebugSnapshot] = useState<SelectionCircleDebugSnapshot>(
    EMPTY_SELECTION_CIRCLE_DEBUG_SNAPSHOT,
  )
  const tableScrollRef = useRef<HTMLDivElement | null>(null)
  const [tableScrollTop, setTableScrollTop] = useState(0)
  const [tableViewportHeight, setTableViewportHeight] = useState(220)
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
      setSearchInput('')
      setDebouncedSearchText('')
      setReviewsByPlaceId({})
      setSelectedReviewsError(null)
      setIsLoadingSelectedReviews(false)
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
        setReviewsByPlaceId({})
        setSelectedReviewsError(null)
        setIsLoadingSelectedReviews(false)
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

  useEffect(() => {
    const debounceTimer = window.setTimeout(() => {
      setDebouncedSearchText(searchInput)
    }, 300)

    return () => {
      clearTimeout(debounceTimer)
    }
  }, [searchInput])

  useEffect(() => {
    const trimmedSearch = debouncedSearchText.trim()
    if (trimmedSearch.length === 0 || places.length === 0) {
      return
    }

    const missingPlaceIds = places
      .map((place) => place.id)
      .filter((placeId) => !Object.prototype.hasOwnProperty.call(reviewsByPlaceId, placeId))

    if (missingPlaceIds.length === 0) {
      return
    }

    let isCancelled = false

    const preloadReviewsForSearch = async () => {
      const loadedEntries = await Promise.all(
        missingPlaceIds.map(async (placeId) => {
          try {
            const reviews = await listPlaceReviews(placeId)
            return [placeId, reviews] as const
          }
          catch {
            return [placeId, [] as PlaceReview[]] as const
          }
        }),
      )

      if (isCancelled) {
        return
      }

      setReviewsByPlaceId((current) => {
        const next = { ...current }
        for (const [placeId, placeReviews] of loadedEntries) {
          if (!Object.prototype.hasOwnProperty.call(next, placeId)) {
            next[placeId] = placeReviews
          }
        }
        return next
      })
    }

    void preloadReviewsForSearch()

    return () => {
      isCancelled = true
    }
  }, [debouncedSearchText, places, reviewsByPlaceId])

  const searchablePlaceEntries = useMemo<SearchablePlaceEntry[]>(
    () =>
      places.map((place) => ({
        place,
        name: place.name,
        address: place.address ?? '',
        category: place.category ?? '',
        amenities: parseJsonArray(place.amenities),
        reviews: (reviewsByPlaceId[place.id] ?? []).map((review) => review.text).join(' '),
      })),
    [places, reviewsByPlaceId],
  )

  const placeSearchFuse = useMemo(
    () =>
      new Fuse(searchablePlaceEntries, {
        threshold: 0.35,
        ignoreLocation: true,
        keys: [
          { name: 'name', weight: 0.4 },
          { name: 'address', weight: 0.2 },
          { name: 'category', weight: 0.15 },
          { name: 'amenities', weight: 0.15 },
          { name: 'reviews', weight: 0.1 },
        ],
      }),
    [searchablePlaceEntries],
  )

  const filteredPlaces = useMemo(() => {
    const trimmedSearch = debouncedSearchText.trim()
    if (!trimmedSearch) {
      return places
    }

    return placeSearchFuse.search(trimmedSearch).map((result) => result.item.place)
  }, [debouncedSearchText, placeSearchFuse, places])

  const tableFilteredPlaces = useMemo(() => {
    const trimmedFilter = tableFilterText.trim().toLowerCase()
    if (!trimmedFilter) {
      return filteredPlaces
    }

    return filteredPlaces.filter((place) =>
      [
        place.name,
        place.category ?? '',
        place.address ?? '',
        place.priceLevel ?? '',
        place.websiteType,
      ]
        .join(' ')
        .toLowerCase()
        .includes(trimmedFilter)
    )
  }, [filteredPlaces, tableFilterText])

  const sortedPlaces = useMemo(() => {
    const sorted = [...tableFilteredPlaces]

    sorted.sort((left, right) => comparePlaces(left, right, sortState))

    return sorted
  }, [tableFilteredPlaces, sortState])

  const visibleRange = useMemo(() => {
    const totalRows = sortedPlaces.length
    if (totalRows === 0) {
      return { start: 0, end: 0 }
    }

    const visibleCount = Math.ceil(tableViewportHeight / TABLE_ROW_HEIGHT)
    const start = Math.max(0, Math.floor(tableScrollTop / TABLE_ROW_HEIGHT) - TABLE_OVERSCAN)
    const end = Math.min(totalRows, start + visibleCount + TABLE_OVERSCAN * 2)
    return { start, end }
  }, [sortedPlaces.length, tableViewportHeight, tableScrollTop])

  const visibleRows = useMemo(
    () => sortedPlaces.slice(visibleRange.start, visibleRange.end),
    [sortedPlaces, visibleRange]
  )

  const topSpacerHeight = visibleRange.start * TABLE_ROW_HEIGHT
  const bottomSpacerHeight = Math.max(0, (sortedPlaces.length - visibleRange.end) * TABLE_ROW_HEIGHT)

  const selectedPlace = useMemo(
    () => filteredPlaces.find((place) => place.id === selectedPlaceId) ?? null,
    [filteredPlaces, selectedPlaceId],
  )
  const selectedPlacePhotoUrls = useMemo(
    () => parseJsonArray(selectedPlace?.photoUrls),
    [selectedPlace?.photoUrls],
  )
  const selectedPlaceAmenities = useMemo(
    () => parseJsonArray(selectedPlace?.amenities),
    [selectedPlace?.amenities],
  )
  const selectedPlaceReviews = useMemo(() => {
    if (!selectedPlace) {
      return []
    }

    return reviewsByPlaceId[selectedPlace.id] ?? []
  }, [reviewsByPlaceId, selectedPlace])
  const selectedPlaceSearchLabel = useMemo(() => buildPlaceSearchLabel(selectedPlace), [selectedPlace])
  const selectedPlaceBookingUrl = useMemo(
    () => buildBookingSearchUrl(selectedPlaceSearchLabel),
    [selectedPlaceSearchLabel],
  )
  const selectedPlaceAirbnbUrl = useMemo(
    () => buildAirbnbSearchUrl(selectedPlaceSearchLabel),
    [selectedPlaceSearchLabel],
  )
  const selectedPlaceGoogleMapsUrl = selectedPlace?.googleMapsUri ?? null

  const defaultMapCenter = getProjectCenter(selectedProject?.bounds) ?? FALLBACK_CENTER

  const handleProjectChange = useCallback((nextProjectId: string) => {
    setSelectedProjectId(nextProjectId)
    navigate(`/projects/${nextProjectId}/explorer`)
  }, [navigate])

  const handleSortChange = useCallback((key: SortKey) => {
    setSortState((current) => {
      if (current.key !== key) {
        return { key, direction: 'asc' }
      }

      return {
        key,
        direction: current.direction === 'asc' ? 'desc' : 'asc',
      }
    })
  }, [])

  const toggleFavorite = useCallback((placeId: string) => {
    setFavoritePlaceIds((current) => {
      const next = new Set(current)
      if (next.has(placeId)) {
        next.delete(placeId)
      }
      else {
        next.add(placeId)
      }

      return next
    })
  }, [])

  const handleTableScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const scrollContainer = event.currentTarget
    setTableScrollTop(scrollContainer.scrollTop)
    setTableViewportHeight(scrollContainer.clientHeight)
  }, [])

  useEffect(() => {
    const scrollContainer = tableScrollRef.current
    if (!scrollContainer) {
      return
    }

    setTableViewportHeight(scrollContainer.clientHeight)

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTableViewportHeight(entry.contentRect.height)
      }
    })
    resizeObserver.observe(scrollContainer)

    return () => {
      resizeObserver.disconnect()
    }
  }, [sortedPlaces.length])

  useEffect(() => {
    setTableScrollTop(0)
    tableScrollRef.current?.scrollTo({ top: 0 })
  }, [selectedProjectId, debouncedSearchText, tableFilterText, sortState])

  useEffect(() => {
    if (!selectedPlaceId) {
      return
    }

    const selectedIndex = sortedPlaces.findIndex((place) => place.id === selectedPlaceId)
    if (selectedIndex < 0) {
      return
    }

    const scrollContainer = tableScrollRef.current
    if (!scrollContainer) {
      return
    }

    const viewportHeight = scrollContainer.clientHeight
    if (viewportHeight <= 0) {
      return
    }

    const visibleStart = Math.floor(scrollContainer.scrollTop / TABLE_ROW_HEIGHT)
    const visibleCount = Math.ceil(viewportHeight / TABLE_ROW_HEIGHT)
    const visibleEnd = visibleStart + visibleCount - 1

    if (selectedIndex >= visibleStart && selectedIndex <= visibleEnd) {
      return
    }

    const targetTop = Math.max(
      0,
      (selectedIndex * TABLE_ROW_HEIGHT) - (viewportHeight / 2) + (TABLE_ROW_HEIGHT / 2),
    )

    scrollContainer.scrollTo({ top: targetTop })
  }, [selectedPlaceId, sortedPlaces])

  useEffect(() => {
    setIsOpeningHoursExpanded(true)
  }, [selectedPlaceId])

  useEffect(() => {
    const placeId = selectedPlace?.id
    if (!placeId) {
      setIsLoadingSelectedReviews(false)
      setSelectedReviewsError(null)
      return
    }

    if (Object.prototype.hasOwnProperty.call(reviewsByPlaceId, placeId)) {
      setIsLoadingSelectedReviews(false)
      setSelectedReviewsError(null)
      return
    }

    let isCancelled = false
    setIsLoadingSelectedReviews(true)
    setSelectedReviewsError(null)

    const loadReviews = async () => {
      try {
        const reviews = await listPlaceReviews(placeId)
        if (isCancelled) {
          return
        }

        setReviewsByPlaceId((current) => ({
          ...current,
          [placeId]: reviews,
        }))
      }
      catch {
        if (!isCancelled) {
          setSelectedReviewsError('Unable to load reviews right now.')
        }
      }
      finally {
        if (!isCancelled) {
          setIsLoadingSelectedReviews(false)
        }
      }
    }

    void loadReviews()

    return () => {
      isCancelled = true
    }
  }, [reviewsByPlaceId, selectedPlace])

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
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <button data-testid="explorer-filters-button" type="button" className="explorer-filters-button">
          Filters
          <span>0</span>
        </button>
      </header>

      {errorMessage ? <p className="explorer-error" data-testid="explorer-error">{errorMessage}</p> : null}

      <section className="explorer-layout">
        <section className="explorer-main-grid">
          <div
            className="explorer-map-panel"
            data-testid="explorer-map-panel"
            role="region"
            aria-label="Explorer map panel"
          >
            {hasMapsKey ? (
              <APIProvider apiKey={API_KEY ?? ''}>
                <Map
                  defaultCenter={defaultMapCenter}
                  defaultZoom={8}
                  gestureHandling="greedy"
                  style={{ width: '100%', height: '100%' }}
                >
                  <MapStyleController />
                  <PlaceMarkerController
                    places={filteredPlaces}
                    selectedPlaceId={selectedPlaceId}
                    onSelectPlace={setSelectedPlaceId}
                    onMarkerDebugSnapshot={setMarkerDebugEntries}
                    onClusterDebugSnapshot={IS_E2E_TEST_MODE ? setClusterDebugSnapshot : undefined}
                    onSelectionCircleDebugSnapshot={IS_E2E_TEST_MODE ? setSelectionCircleDebugSnapshot : undefined}
                  />
                </Map>
              </APIProvider>
            ) : (
              <div className="explorer-map-fallback" data-testid="explorer-map-fallback">Set `VITE_GOOGLE_MAPS_API_KEY` to view Explorer map.</div>
            )}
            {IS_E2E_TEST_MODE ? (
              <>
                <pre hidden data-testid="explorer-marker-debug">{JSON.stringify(markerDebugEntries)}</pre>
                <pre hidden data-testid="explorer-cluster-debug">{JSON.stringify(clusterDebugSnapshot)}</pre>
                <pre hidden data-testid="explorer-selection-circle-debug">
                  {JSON.stringify(selectionCircleDebugSnapshot)}
                </pre>
              </>
            ) : null}
          </div>

          <aside className="explorer-detail-panel" data-testid="explorer-detail-panel">
            {selectedPlace ? (
              <section className="explorer-detail-content">
                <p className="explorer-detail-kicker">Selected Place</p>
                <div className="explorer-detail-header-row">
                  <div>
                    <h2 data-testid="explorer-detail-name">{selectedPlace.name}</h2>
                    <p data-testid="explorer-detail-category" className="explorer-detail-category-text">
                      {selectedPlace.category ?? 'Uncategorized'}
                    </p>
                  </div>
                  <span
                    data-testid="explorer-detail-website-badge"
                    className={`explorer-website-badge explorer-website-${selectedPlace.websiteType}`}
                  >
                    {detailWebsiteLabel(selectedPlace.websiteType)}
                  </span>
                </div>

                <p data-testid="explorer-detail-rating" className="explorer-detail-rating-row">
                  <span className="explorer-detail-rating-stars">{renderRatingStars(selectedPlace.rating)}</span>
                  <span className="explorer-detail-rating-value">{selectedPlace.rating?.toFixed(1) ?? 'N/A'}</span>
                  <span className="explorer-detail-rating-count">{selectedPlace.reviewCount ?? 0} reviews</span>
                </p>

                <section className="explorer-detail-section">
                  <h3>Contact</h3>
                  <p data-testid="explorer-detail-website" className="explorer-detail-contact-row">
                    <span className="explorer-detail-icon">🌐</span>
                    {selectedPlace.website ? (
                      <a href={selectedPlace.website} target="_blank" rel="noreferrer" className="explorer-detail-link">
                        {selectedPlace.website}
                      </a>
                    ) : (
                      <span>—</span>
                    )}
                  </p>
                  <p data-testid="explorer-detail-address" className="explorer-detail-contact-row">
                    <span className="explorer-detail-icon">📍</span>
                    <span>{selectedPlace.address ?? 'No address available'}</span>
                  </p>
                  <p data-testid="explorer-detail-phone" className="explorer-detail-contact-row">
                    <span className="explorer-detail-icon">📞</span>
                    {selectedPlace.phone ? (
                      <a href={toPhoneHref(selectedPlace.phone)} className="explorer-detail-link">{selectedPlace.phone}</a>
                    ) : (
                      <span>—</span>
                    )}
                  </p>
                  <p data-testid="explorer-detail-price" className="explorer-detail-contact-row">
                    <span className="explorer-detail-icon">💲</span>
                    <span>{formatPriceLevel(selectedPlace.priceLevel)}</span>
                  </p>
                </section>

                <div data-testid="explorer-detail-amenities" className="explorer-detail-section">
                  <h3>Amenities</h3>
                  {selectedPlaceAmenities.length > 0 ? (
                    <ul className="explorer-detail-amenity-chips">
                      {selectedPlaceAmenities.map((amenity) => (
                        <li key={amenity}>{amenity}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>—</p>
                  )}
                </div>

                <div data-testid="explorer-detail-photos" className="explorer-detail-section">
                  <h3>Photos</h3>
                  {selectedPlacePhotoUrls.length > 0 ? (
                    <div className="explorer-detail-photo-strip">
                      {selectedPlacePhotoUrls.map((photoUrl, index) => (
                        <a
                          key={photoUrl}
                          data-testid={`explorer-detail-photo-${index}`}
                          href={photoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="explorer-detail-photo-link"
                        >
                          <img src={photoUrl} alt={`${selectedPlace.name} photo ${index + 1}`} loading="lazy" />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p>—</p>
                  )}
                </div>

                <div data-testid="explorer-detail-opening-hours" className="explorer-detail-accordion">
                  <button
                    type="button"
                    className="explorer-detail-accordion-toggle"
                    onClick={() => setIsOpeningHoursExpanded((current) => !current)}
                  >
                    Opening hours
                    <span aria-hidden="true">{isOpeningHoursExpanded ? '▾' : '▸'}</span>
                  </button>
                  {isOpeningHoursExpanded ? (
                    <p>{selectedPlace.openingHours ?? 'No opening hours available.'}</p>
                  ) : null}
                </div>

                <p data-testid="explorer-detail-scraped-at" className="explorer-detail-scraped-at">
                  Scraped at: {formatScrapedAt(selectedPlace.scrapedAt)}
                </p>

                <div data-testid="explorer-detail-reviews" className="explorer-detail-section">
                  <h3>Reviews</h3>
                  {isLoadingSelectedReviews ? (
                    <p>Loading reviews…</p>
                  ) : selectedReviewsError ? (
                    <p>{selectedReviewsError}</p>
                  ) : selectedPlaceReviews.length > 0 ? (
                    <ul className="explorer-detail-review-list">
                      {selectedPlaceReviews.map((review) => (
                        <li key={review.id} className="explorer-detail-review-item">
                          <div className="explorer-detail-review-meta">
                            <span className="explorer-detail-review-stars">{renderRatingStars(review.rating)}</span>
                            <span className="explorer-detail-review-rating">{review.rating.toFixed(1)}</span>
                            {review.relativeDate ? (
                              <span className="explorer-detail-review-date">{review.relativeDate}</span>
                            ) : null}
                          </div>
                          <p>{truncateReviewText(review.text)}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No reviews available.</p>
                  )}
                </div>

                <div className="explorer-detail-actions">
                  <a
                    data-testid="explorer-detail-action-open-google-maps"
                    href={selectedPlaceGoogleMapsUrl ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="explorer-detail-action-button"
                  >
                    Open in Google Maps
                  </a>
                  <a
                    data-testid="explorer-detail-action-search-booking"
                    href={selectedPlaceBookingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="explorer-detail-action-button"
                  >
                    Search on Booking.com
                  </a>
                  <a
                    data-testid="explorer-detail-action-search-airbnb"
                    href={selectedPlaceAirbnbUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="explorer-detail-action-button"
                  >
                    Search on Airbnb
                  </a>
                </div>
              </section>
            ) : (
              <p className="explorer-placeholder">Select a marker to inspect place details.</p>
            )}
          </aside>

          <section
            className="explorer-table-panel"
            data-testid="explorer-table-panel"
            role="region"
            aria-label="Explorer table panel"
          >
            <div className="explorer-table-toolbar">
              <span data-testid="explorer-table-count">{isLoadingPlaces ? 'Loading places…' : `${sortedPlaces.length} places`}</span>
              <div className="explorer-table-filter-wrap">
                <input
                  data-testid="explorer-table-filter-input"
                  type="search"
                  placeholder="Filter results..."
                  value={tableFilterText}
                  onChange={(event) => setTableFilterText(event.target.value)}
                />
                <button
                  data-testid="explorer-table-filter-clear"
                  type="button"
                  onClick={() => setTableFilterText('')}
                  disabled={tableFilterText.length === 0}
                >
                  Clear
                </button>
              </div>
            </div>

            <div
              data-testid="explorer-table-scroll"
              className="explorer-table-scroll"
              ref={tableScrollRef}
              onScroll={handleTableScroll}
            >
              <table data-testid="explorer-table" aria-label="Explorer places table">
                <thead>
                  <tr>
                    <th>
                      <button type="button" className="explorer-sort-button" onClick={() => handleSortChange('name')}>
                        Name {sortIndicator(sortState, 'name')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="explorer-sort-button" onClick={() => handleSortChange('category')}>
                        Category {sortIndicator(sortState, 'category')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="explorer-sort-button" onClick={() => handleSortChange('rating')}>
                        Rating {sortIndicator(sortState, 'rating')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="explorer-sort-button" onClick={() => handleSortChange('reviewCount')}>
                        Reviews {sortIndicator(sortState, 'reviewCount')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="explorer-sort-button" onClick={() => handleSortChange('priceLevel')}>
                        Price {sortIndicator(sortState, 'priceLevel')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="explorer-sort-button" onClick={() => handleSortChange('websiteType')}>
                        Website {sortIndicator(sortState, 'websiteType')}
                      </button>
                    </th>
                    <th>
                      <button type="button" className="explorer-sort-button" onClick={() => handleSortChange('address')}>
                        Address {sortIndicator(sortState, 'address')}
                      </button>
                    </th>
                    <th>Favorite</th>
                  </tr>
                </thead>
                <tbody>
                  {topSpacerHeight > 0 ? (
                    <tr aria-hidden="true" className="explorer-spacer-row">
                      <td colSpan={8} style={{ height: `${topSpacerHeight}px` }} />
                    </tr>
                  ) : null}

                  {visibleRows.map((place) => (
                    <tr
                      key={place.id}
                      data-testid={`explorer-row-${place.id}`}
                      data-selected={place.id === selectedPlaceId ? 'true' : 'false'}
                      aria-selected={place.id === selectedPlaceId}
                      className={place.id === selectedPlaceId ? 'is-selected' : ''}
                      tabIndex={0}
                      onClick={() => setSelectedPlaceId(place.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedPlaceId(place.id)
                        }
                      }}
                    >
                      <td>{place.name}</td>
                      <td>{place.category ?? '—'}</td>
                      <td>{place.rating?.toFixed(1) ?? '—'}</td>
                      <td>{place.reviewCount ?? '—'}</td>
                      <td data-testid={`explorer-price-${place.id}`}>{formatPriceLevel(place.priceLevel)}</td>
                      <td>
                        <span
                          data-testid={`explorer-website-badge-${place.id}`}
                          className={`explorer-website-badge explorer-website-${place.websiteType}`}
                        >
                          {websiteLabel(place.websiteType)}
                        </span>
                      </td>
                      <td>{place.address ?? '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="explorer-favorite-button"
                          aria-label={`Toggle favorite for ${place.name}`}
                          aria-pressed={favoritePlaceIds.has(place.id)}
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleFavorite(place.id)
                          }}
                        >
                          {favoritePlaceIds.has(place.id) ? '★' : '☆'}
                        </button>
                      </td>
                    </tr>
                  ))}

                  {bottomSpacerHeight > 0 ? (
                    <tr aria-hidden="true" className="explorer-spacer-row">
                      <td colSpan={8} style={{ height: `${bottomSpacerHeight}px` }} />
                    </tr>
                  ) : null}
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
  onMarkerDebugSnapshot?: (entries: MarkerDebugEntry[]) => void
  onClusterDebugSnapshot?: (snapshot: ClusterDebugSnapshot) => void
  onSelectionCircleDebugSnapshot?: (snapshot: SelectionCircleDebugSnapshot) => void
}

function PlaceMarkerController({
  places,
  selectedPlaceId,
  onSelectPlace,
  onMarkerDebugSnapshot,
  onClusterDebugSnapshot,
  onSelectionCircleDebugSnapshot,
}: PlaceMarkerControllerProps) {
  const map = useMap()
  const markersRef = useRef(new globalThis.Map<string, google.maps.Marker>())
  const clustererRef = useRef<MarkerClusterer | null>(null)
  const selectionCircleRef = useRef<google.maps.Circle | null>(null)
  const onSelectRef = useRef(onSelectPlace)
  const onMarkerDebugSnapshotRef = useRef(onMarkerDebugSnapshot)
  const onClusterDebugSnapshotRef = useRef(onClusterDebugSnapshot)
  const onSelectionCircleDebugSnapshotRef = useRef(onSelectionCircleDebugSnapshot)
  const placesById = useMemo(() => new globalThis.Map(places.map((place) => [place.id, place])), [places])

  const emitClusterDebugSnapshot = useCallback(() => {
    const clusterer = clustererRef.current
    if (!clusterer) {
      onClusterDebugSnapshotRef.current?.(EMPTY_CLUSTER_DEBUG_SNAPSHOT)
      return
    }

    const internal = clusterer as unknown as {
      clusters?: Array<{ count?: number; marker?: { getLabel?: () => string | google.maps.MarkerLabel | null } }>
    }
    const clusters = internal.clusters ?? []
    const groupedClusters = clusters.filter((cluster) => (cluster.count ?? 0) > 1)
    const clusterLabels = groupedClusters.flatMap((cluster) => {
      const label = cluster.marker?.getLabel?.()
      if (!label) {
        return []
      }

      if (typeof label === 'string') {
        return [label]
      }

      return label.text ? [label.text] : []
    })

    onClusterDebugSnapshotRef.current?.({
      totalClusters: clusters.length,
      groupedClusterCount: groupedClusters.length,
      clusterLabels,
      maxClusterSize: groupedClusters.reduce(
        (maxClusterSize, cluster) => Math.max(maxClusterSize, cluster.count ?? 0),
        0,
      ),
    })
  }, [])

  const emitSelectionCircleDebugSnapshot = useCallback((snapshot: SelectionCircleDebugSnapshot) => {
    onSelectionCircleDebugSnapshotRef.current?.(snapshot)
  }, [])

  useEffect(() => {
    onSelectRef.current = onSelectPlace
  }, [onSelectPlace])

  useEffect(() => {
    onMarkerDebugSnapshotRef.current = onMarkerDebugSnapshot
  }, [onMarkerDebugSnapshot])

  useEffect(() => {
    onClusterDebugSnapshotRef.current = onClusterDebugSnapshot
  }, [onClusterDebugSnapshot])

  useEffect(() => {
    onSelectionCircleDebugSnapshotRef.current = onSelectionCircleDebugSnapshot
  }, [onSelectionCircleDebugSnapshot])

  useEffect(() => {
    if (!IS_E2E_TEST_MODE) {
      return
    }

    const debugController: ExplorerE2EMapDebugController = {
      clickMarker: (placeId: string) => {
        const marker = markersRef.current.get(placeId)
        if (!marker) {
          return false
        }

        google.maps.event.trigger(marker, 'click')
        return true
      },
      clickMap: () => {
        if (!map) {
          return false
        }

        google.maps.event.trigger(map, 'click')
        return true
      },
      setZoom: (zoom: number) => {
        if (!map || !Number.isFinite(zoom)) {
          return false
        }

        map.setZoom(zoom)
        return true
      },
    }

    window.__gomapsExplorerDebug = debugController

    return () => {
      if (window.__gomapsExplorerDebug === debugController) {
        delete window.__gomapsExplorerDebug
      }
    }
  }, [map])

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
    emitClusterDebugSnapshot()

    const clickListener = map.addListener('click', () => {
      onSelectRef.current(null)
    })
    const clusteringListener = clusterer.addListener(MarkerClustererEvents.CLUSTERING_END, () => {
      emitClusterDebugSnapshot()
    })

    return () => {
      clickListener.remove()
      clusteringListener.remove()
      clusterer.clearMarkers()
      clusterer.setMap(null)
      clustererRef.current = null
      onClusterDebugSnapshotRef.current?.(EMPTY_CLUSTER_DEBUG_SNAPSHOT)
    }
  }, [emitClusterDebugSnapshot, map])

  useEffect(() => {
    if (!map || !clustererRef.current) {
      return
    }

    const nextIds = new Set(places.map((place) => place.id))
    const markerDebugEntries: MarkerDebugEntry[] = []

    for (const [placeId, marker] of markersRef.current.entries()) {
      if (nextIds.has(placeId)) {
        continue
      }

      marker.setMap(null)
      markersRef.current.delete(placeId)
    }

    for (const place of places) {
      const fillColor = ratingColor(place.rating)
      const icon = markerIcon(place.rating, place.id === selectedPlaceId)
      const existing = markersRef.current.get(place.id)
      if (existing) {
        existing.setPosition({ lat: place.lat, lng: place.lng })
        existing.setIcon(icon)
        existing.setZIndex(place.id === selectedPlaceId ? 1050 : 1000)
        markerDebugEntries.push({
          placeId: place.id,
          rating: place.rating,
          fillColor,
        })
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
      markerDebugEntries.push({
        placeId: place.id,
        rating: place.rating,
        fillColor,
      })
    }

    clustererRef.current.clearMarkers()
    clustererRef.current.addMarkers(Array.from(markersRef.current.values()))
    clustererRef.current.render()
    onMarkerDebugSnapshotRef.current?.(markerDebugEntries)
    emitClusterDebugSnapshot()
  }, [emitClusterDebugSnapshot, map, places, selectedPlaceId])

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
      emitSelectionCircleDebugSnapshot(EMPTY_SELECTION_CIRCLE_DEBUG_SNAPSHOT)
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

    const target = { lat: selectedPlace.lat, lng: selectedPlace.lng }
    map.panTo(target)

    selectionCircleRef.current = circle
    circle.setCenter(target)
    circle.setRadius(150)
    emitSelectionCircleDebugSnapshot({
      visible: true,
      placeId: selectedPlace.id,
      center: target,
      radius: 150,
    })

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
  }, [emitSelectionCircleDebugSnapshot, map, placesById, selectedPlaceId])

  useEffect(() => () => {
    for (const marker of markersRef.current.values()) {
      marker.setMap(null)
    }
    markersRef.current.clear()
    if (selectionCircleRef.current) {
      selectionCircleRef.current.setMap(null)
      selectionCircleRef.current = null
    }
    onClusterDebugSnapshotRef.current?.(EMPTY_CLUSTER_DEBUG_SNAPSHOT)
    onSelectionCircleDebugSnapshotRef.current?.(EMPTY_SELECTION_CIRCLE_DEBUG_SNAPSHOT)
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

const websiteLabel = (websiteType: Place['websiteType']): string => {
  if (websiteType === 'ota') {
    return 'OTA'
  }

  if (websiteType === 'direct') {
    return 'Direct'
  }

  if (websiteType === 'social') {
    return 'Social'
  }

  return 'Unknown'
}

const detailWebsiteLabel = (websiteType: Place['websiteType']): string => {
  if (websiteType === 'direct') {
    return 'Book Direct'
  }

  return websiteLabel(websiteType)
}

const renderRatingStars = (rating: number | null): string => {
  if (rating === null || Number.isNaN(rating)) {
    return '☆☆☆☆☆'
  }

  const clamped = Math.min(5, Math.max(0, Math.round(rating)))
  return `${'★'.repeat(clamped)}${'☆'.repeat(5 - clamped)}`
}

const toPhoneHref = (phoneRaw: string): string => {
  const normalized = phoneRaw.replace(/\s+/g, '')
  return `tel:${normalized}`
}

const truncateReviewText = (text: string): string => {
  const trimmed = text.trim()
  if (trimmed.length <= REVIEW_SNIPPET_LENGTH) {
    return trimmed
  }

  return `${trimmed.slice(0, REVIEW_SNIPPET_LENGTH - 1)}…`
}

const formatScrapedAt = (scrapedAtRaw: string): string => {
  const timestamp = Date.parse(scrapedAtRaw)
  if (!Number.isFinite(timestamp)) {
    return scrapedAtRaw
  }

  return new Date(timestamp).toLocaleString()
}

const buildPlaceSearchLabel = (place: Place | null): string => {
  if (!place) {
    return ''
  }

  const chunks = [place.name, place.address ?? '']
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  return chunks.join(', ')
}

const buildBookingSearchUrl = (searchLabel: string): string =>
  `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(searchLabel)}`

const buildAirbnbSearchUrl = (searchLabel: string): string =>
  `https://www.airbnb.com/s/${encodeURIComponent(searchLabel)}/homes`

const formatPriceLevel = (priceLevel: string | null): string => {
  if (!priceLevel) {
    return '—'
  }

  const normalized = priceLevel.trim()
  if (!normalized) {
    return '—'
  }

  if (normalized.startsWith('$')) {
    return normalized
  }

  return normalized
    .replace('PRICE_LEVEL_', '')
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const parseJsonArray = (value: string | null | undefined): string[] => {
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

const sortIndicator = (sortState: SortState, key: SortKey): string => {
  if (sortState.key !== key) {
    return '↕'
  }

  return sortState.direction === 'asc' ? '↑' : '↓'
}

const comparePlaces = (left: Place, right: Place, sortState: SortState): number => {
  const directionMultiplier = sortState.direction === 'asc' ? 1 : -1

  const compareResult = (() => {
    switch (sortState.key) {
      case 'rating':
        return compareNullableNumber(left.rating, right.rating)
      case 'reviewCount':
        return compareNullableNumber(left.reviewCount, right.reviewCount)
      case 'name':
        return compareNullableString(left.name, right.name)
      case 'category':
        return compareNullableString(left.category, right.category)
      case 'priceLevel':
        return compareNullableString(formatPriceLevel(left.priceLevel), formatPriceLevel(right.priceLevel))
      case 'websiteType':
        return compareNullableString(websiteLabel(left.websiteType), websiteLabel(right.websiteType))
      case 'address':
        return compareNullableString(left.address, right.address)
      default:
        return 0
    }
  })()

  if (compareResult !== 0) {
    return compareResult * directionMultiplier
  }

  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

const compareNullableNumber = (left: number | null, right: number | null): number => {
  if (left === null && right === null) {
    return 0
  }
  if (left === null) {
    return 1
  }
  if (right === null) {
    return -1
  }
  return left - right
}

const compareNullableString = (left: string | null, right: string | null): number => {
  const leftValue = (left ?? '').trim()
  const rightValue = (right ?? '').trim()

  if (!leftValue && !rightValue) {
    return 0
  }
  if (!leftValue) {
    return 1
  }
  if (!rightValue) {
    return -1
  }

  return leftValue.localeCompare(rightValue, undefined, { sensitivity: 'base' })
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
