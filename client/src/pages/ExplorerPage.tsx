import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps'
import { MarkerClusterer, MarkerClustererEvents } from '@googlemaps/markerclusterer'
import Fuse from 'fuse.js'
import type { ReactNode, UIEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  addShortlistEntry,
  createShortlist,
  getErrorMessage,
  getProject,
  listPlaceReviews,
  listPlaces,
  listProjects,
  listShortlistEntries,
  listShortlists,
  removeShortlistEntry,
  type Place,
  type PlaceReview,
  type Project,
  type Shortlist,
} from '../lib/api'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined
const IS_E2E_TEST_MODE = import.meta.env.VITE_E2E_TEST_MODE === '1'
const FALLBACK_CENTER = { lat: 40, lng: 9 }
const TABLE_ROW_HEIGHT = 44
const TABLE_OVERSCAN = 10
const REVIEW_SNIPPET_LENGTH = 220
const REVIEW_PRELOAD_BATCH_SIZE = 12
const RATING_FILTER_MIN = 1
const RATING_FILTER_MAX = 5
const FILTER_PARAM_RATING_MIN = 'ratingMin'
const FILTER_PARAM_RATING_MAX = 'ratingMax'
const FILTER_PARAM_CATEGORIES = 'categories'
const FILTER_PARAM_WEBSITE = 'website'
const FILTER_PARAM_REVIEW_KEYWORD = 'reviewKeyword'
const FILTER_PARAM_DISTANCE_LAT = 'distanceLat'
const FILTER_PARAM_DISTANCE_LNG = 'distanceLng'
const FILTER_PARAM_DISTANCE_RADIUS_KM = 'distanceRadiusKm'
const DISTANCE_FILTER_MIN_KM = 1
const DISTANCE_FILTER_MAX_KM = 50
const DEFAULT_DISTANCE_RADIUS_KM = 10
const DEFAULT_SHORTLIST_NAME = 'Starred'

const EXPLORER_CATEGORY_OPTIONS = [
  { id: 'hotel', label: 'Hotel' },
  { id: 'vacation-rental', label: 'Vacation Rental' },
  { id: 'bed-breakfast', label: 'B&B' },
  { id: 'apartment', label: 'Apartment' },
] as const

const FILTER_WEBSITE_OPTIONS = ['all', 'direct', 'ota', 'unknown'] as const

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

type ExplorerCategoryFilter = (typeof EXPLORER_CATEGORY_OPTIONS)[number]['id']
type ExplorerWebsiteFilter = (typeof FILTER_WEBSITE_OPTIONS)[number]

interface ExplorerFilterState {
  ratingMin: number
  ratingMax: number
  categories: ExplorerCategoryFilter[]
  website: ExplorerWebsiteFilter
  reviewKeyword: string
  distanceCenter: { lat: number; lng: number } | null
  distanceRadiusKm: number
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
  const [searchParams, setSearchParams] = useSearchParams()
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
  const [favoriteMutationIds, setFavoriteMutationIds] = useState<Set<string>>(new Set())
  const [defaultShortlist, setDefaultShortlist] = useState<Shortlist | null>(null)
  const [reviewsByPlaceId, setReviewsByPlaceId] = useState<Record<string, PlaceReview[]>>({})
  const [isLoadingSelectedReviews, setIsLoadingSelectedReviews] = useState(false)
  const [selectedReviewsError, setSelectedReviewsError] = useState<string | null>(null)
  const [isOpeningHoursExpanded, setIsOpeningHoursExpanded] = useState(true)
  const [markerDebugEntries, setMarkerDebugEntries] = useState<MarkerDebugEntry[]>([])
  const [clusterDebugSnapshot, setClusterDebugSnapshot] = useState<ClusterDebugSnapshot>(EMPTY_CLUSTER_DEBUG_SNAPSHOT)
  const [selectionCircleDebugSnapshot, setSelectionCircleDebugSnapshot] = useState<SelectionCircleDebugSnapshot>(
    EMPTY_SELECTION_CIRCLE_DEBUG_SNAPSHOT,
  )
  const [isFilterSidebarOpen, setIsFilterSidebarOpen] = useState(true)
  const [filters, setFilters] = useState<ExplorerFilterState>(() => parseExplorerFiltersFromSearchParams(searchParams))
  const tableScrollRef = useRef<HTMLDivElement | null>(null)
  const [tableScrollTop, setTableScrollTop] = useState(0)
  const [tableViewportHeight, setTableViewportHeight] = useState(220)
  const [isLoadingProjects, setIsLoadingProjects] = useState(true)
  const [isLoadingPlaces, setIsLoadingPlaces] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const reviewsByPlaceIdRef = useRef(reviewsByPlaceId)
  const reviewRequestPromisesRef = useRef(new globalThis.Map<string, Promise<PlaceReview[]>>())

  const hasMapsKey = Boolean(API_KEY)
  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters])

  useEffect(() => {
    const nextFilters = parseExplorerFiltersFromSearchParams(searchParams)
    setFilters((current) => (areFilterStatesEqual(current, nextFilters) ? current : nextFilters))
  }, [searchParams])

  useEffect(() => {
    const nextSearchParams = buildExplorerFilterSearchParams(searchParams, filters)
    if (nextSearchParams.toString() === searchParams.toString()) {
      return
    }

    setSearchParams(nextSearchParams, { replace: true })
  }, [filters, searchParams, setSearchParams])

  useEffect(() => {
    reviewsByPlaceIdRef.current = reviewsByPlaceId
  }, [reviewsByPlaceId])

  const hasCachedReviews = useCallback(
    (placeId: string): boolean => Object.prototype.hasOwnProperty.call(reviewsByPlaceIdRef.current, placeId),
    [],
  )

  const loadReviewsForPlace = useCallback(async (placeId: string): Promise<PlaceReview[]> => {
    const cachedReviews = reviewsByPlaceIdRef.current[placeId]
    if (cachedReviews) {
      return cachedReviews
    }

    const inFlightRequest = reviewRequestPromisesRef.current.get(placeId)
    if (inFlightRequest) {
      return inFlightRequest
    }

    const requestPromise = listPlaceReviews(placeId)
      .then((reviews) => {
        setReviewsByPlaceId((current) => {
          if (Object.prototype.hasOwnProperty.call(current, placeId)) {
            return current
          }

          return {
            ...current,
            [placeId]: reviews,
          }
        })
        return reviews
      })
      .finally(() => {
        reviewRequestPromisesRef.current.delete(placeId)
      })

    reviewRequestPromisesRef.current.set(placeId, requestPromise)
    return requestPromise
  }, [])

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
        setSelectedProjectId((currentProjectId) =>
          routeProjectId
          ?? currentProjectId
          ?? loadedProjects[0]?.id
          ?? null)
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
  }, [routeProjectId])

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
      setFavoritePlaceIds(new Set())
      setFavoriteMutationIds(new Set())
      setDefaultShortlist(null)
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
        setFavoriteMutationIds(new Set())
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
    const trimmedReviewKeyword = filters.reviewKeyword.trim()
    if ((trimmedSearch.length === 0 && trimmedReviewKeyword.length === 0) || places.length === 0) {
      return
    }

    const missingPlaceIds = places
      .map((place) => place.id)
      .filter((placeId) => !hasCachedReviews(placeId))

    if (missingPlaceIds.length === 0) {
      return
    }

    let isCancelled = false

    const preloadReviewsForSearch = async () => {
      for (let offset = 0; offset < missingPlaceIds.length; offset += REVIEW_PRELOAD_BATCH_SIZE) {
        const batch = missingPlaceIds.slice(offset, offset + REVIEW_PRELOAD_BATCH_SIZE)

        await Promise.all(
          batch.map(async (placeId) => {
            try {
              await loadReviewsForPlace(placeId)
            }
            catch {
              if (isCancelled) {
                return
              }

              setReviewsByPlaceId((current) => {
                if (Object.prototype.hasOwnProperty.call(current, placeId)) {
                  return current
                }

                return {
                  ...current,
                  [placeId]: [],
                }
              })
            }
          }),
        )

        if (isCancelled) {
          return
        }
      }
    }

    void preloadReviewsForSearch()

    return () => {
      isCancelled = true
    }
  }, [debouncedSearchText, filters.reviewKeyword, hasCachedReviews, loadReviewsForPlace, places])

  useEffect(() => {
    if (!selectedProjectId) {
      return
    }

    let isCancelled = false

    const syncDefaultShortlist = async () => {
      try {
        const existingShortlists = await listShortlists(selectedProjectId)
        if (isCancelled) {
          return
        }

        let shortlist = existingShortlists.find((item) => item.name === DEFAULT_SHORTLIST_NAME)
        if (!shortlist) {
          shortlist = await createShortlist(selectedProjectId, DEFAULT_SHORTLIST_NAME)
          if (isCancelled) {
            return
          }
        }

        setDefaultShortlist(shortlist)
        const entries = await listShortlistEntries(shortlist.id)
        if (isCancelled) {
          return
        }

        setFavoritePlaceIds(new Set(entries.map((entry) => entry.placeId)))
      }
      catch (error) {
        if (!isCancelled) {
          setDefaultShortlist(null)
          setFavoritePlaceIds(new Set())
          setErrorMessage(getErrorMessage(error, 'Unable to load shortlist favorites right now.'))
        }
      }
    }

    void syncDefaultShortlist()

    return () => {
      isCancelled = true
    }
  }, [selectedProjectId])

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
    const searchMatchedPlaces = !trimmedSearch
      ? places
      : placeSearchFuse.search(trimmedSearch).map((result) => result.item.place)

    return searchMatchedPlaces.filter((place) => placeMatchesExplorerFilters(place, filters, reviewsByPlaceId))
  }, [debouncedSearchText, filters, placeSearchFuse, places, reviewsByPlaceId])

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
  const selectedPlaceHasSearchContext = useMemo(() => hasPlaceSearchContext(selectedPlace), [selectedPlace])
  const selectedPlaceSearchLabel = useMemo(
    () => (selectedPlaceHasSearchContext ? buildPlaceSearchLabel(selectedPlace) : ''),
    [selectedPlace, selectedPlaceHasSearchContext],
  )
  const selectedPlaceBookingUrl = useMemo(
    () => (selectedPlaceHasSearchContext ? buildBookingSearchUrl(selectedPlaceSearchLabel) : null),
    [selectedPlaceHasSearchContext, selectedPlaceSearchLabel],
  )
  const selectedPlaceAirbnbUrl = useMemo(
    () => (selectedPlaceHasSearchContext ? buildAirbnbSearchUrl(selectedPlaceSearchLabel) : null),
    [selectedPlaceHasSearchContext, selectedPlaceSearchLabel],
  )
  const selectedPlaceGoogleMapsUrl = selectedPlace?.googleMapsUri ?? null
  const selectedPlaceGoogleMapsPhotosUrl = selectedPlace?.googleMapsPhotosUri ?? selectedPlaceGoogleMapsUrl
  const shouldShowExternalSearchActions = selectedPlaceHasSearchContext
    && selectedPlaceGoogleMapsUrl !== null
    && selectedPlaceGoogleMapsUrl.trim().length > 0
    && selectedPlaceGoogleMapsPhotosUrl !== null
    && selectedPlaceGoogleMapsPhotosUrl.trim().length > 0
    && selectedPlaceBookingUrl !== null
    && selectedPlaceAirbnbUrl !== null
  const distanceCenterLabel = formatDistanceCenter(filters.distanceCenter)

  const defaultMapCenter = getProjectCenter(selectedProject?.bounds) ?? FALLBACK_CENTER
  const searchSuffix = searchParams.toString().length > 0 ? `?${searchParams.toString()}` : ''

  const handleCategoryFilterToggle = useCallback((categoryId: ExplorerCategoryFilter) => {
    setFilters((current) => {
      const nextCategories = current.categories.includes(categoryId)
        ? current.categories.filter((value) => value !== categoryId)
        : [...current.categories, categoryId]

      return {
        ...current,
        categories: sortCategoryFilters(nextCategories),
      }
    })
  }, [])

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_EXPLORER_FILTERS)
  }, [])

  const handleRatingMinChange = useCallback((value: number) => {
    setFilters((current) => ({
      ...current,
      ratingMin: Math.min(value, current.ratingMax),
    }))
  }, [])

  const handleRatingMaxChange = useCallback((value: number) => {
    setFilters((current) => ({
      ...current,
      ratingMax: Math.max(value, current.ratingMin),
    }))
  }, [])

  const handleWebsiteFilterChange = useCallback((website: ExplorerWebsiteFilter) => {
    setFilters((current) => ({
      ...current,
      website,
    }))
  }, [])

  const handleReviewKeywordChange = useCallback((reviewKeyword: string) => {
    setFilters((current) => ({
      ...current,
      reviewKeyword,
    }))
  }, [])

  const handleDistanceRadiusChange = useCallback((distanceRadiusKm: number) => {
    setFilters((current) => ({
      ...current,
      distanceRadiusKm: clamp(distanceRadiusKm, DISTANCE_FILTER_MIN_KM, DISTANCE_FILTER_MAX_KM),
    }))
  }, [])

  const handleDistanceCenterChange = useCallback((distanceCenter: { lat: number; lng: number } | null) => {
    setFilters((current) => ({
      ...current,
      distanceCenter,
    }))
  }, [])

  const clearDistanceCenter = useCallback(() => {
    setFilters((current) => ({
      ...current,
      distanceCenter: null,
    }))
  }, [])

  const handleProjectChange = useCallback((nextProjectId: string) => {
    setSelectedProjectId(nextProjectId)
    navigate(`/projects/${nextProjectId}/explorer${searchSuffix}`)
  }, [navigate, searchSuffix])

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

  const toggleFavorite = useCallback(async (placeId: string) => {
    if (!defaultShortlist) {
      setErrorMessage('Favorite shortlist is not ready yet.')
      return
    }

    if (favoriteMutationIds.has(placeId)) {
      return
    }

    const wasFavorite = favoritePlaceIds.has(placeId)
    setFavoriteMutationIds((current) => new Set(current).add(placeId))
    setFavoritePlaceIds((current) => {
      const next = new Set(current)
      if (wasFavorite) {
        next.delete(placeId)
      }
      else {
        next.add(placeId)
      }

      return next
    })

    try {
      if (wasFavorite) {
        await removeShortlistEntry(defaultShortlist.id, placeId)
      }
      else {
        await addShortlistEntry(defaultShortlist.id, placeId)
      }
    }
    catch (error) {
      setFavoritePlaceIds((current) => {
        const next = new Set(current)
        if (wasFavorite) {
          next.add(placeId)
        }
        else {
          next.delete(placeId)
        }
        return next
      })
      setErrorMessage(getErrorMessage(error, 'Unable to update shortlist favorite right now.'))
    }
    finally {
      setFavoriteMutationIds((current) => {
        const next = new Set(current)
        next.delete(placeId)
        return next
      })
    }
  }, [defaultShortlist, favoriteMutationIds, favoritePlaceIds])

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
  }, [])

  useEffect(() => {
    setTableScrollTop(0)
    tableScrollRef.current?.scrollTo({ top: 0 })
  }, [selectedProjectId, debouncedSearchText, tableFilterText, sortState, filters])

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
    if (!selectedPlaceId) {
      return
    }

    const existsInFilteredPlaces = filteredPlaces.some((place) => place.id === selectedPlaceId)
    if (!existsInFilteredPlaces) {
      setSelectedPlaceId(filteredPlaces[0]?.id ?? null)
    }
  }, [filteredPlaces, selectedPlaceId])

  useEffect(() => {
    const placeId = selectedPlace?.id
    if (!placeId) {
      setIsLoadingSelectedReviews(false)
      setSelectedReviewsError(null)
      return
    }

    if (hasCachedReviews(placeId)) {
      setIsLoadingSelectedReviews(false)
      setSelectedReviewsError(null)
      return
    }

    let isCancelled = false
    setIsLoadingSelectedReviews(true)
    setSelectedReviewsError(null)

    const loadReviews = async () => {
      try {
        await loadReviewsForPlace(placeId)
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
  }, [hasCachedReviews, loadReviewsForPlace, selectedPlace])

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

        <button
          data-testid="explorer-filters-button"
          type="button"
          className="explorer-filters-button"
          onClick={() => setIsFilterSidebarOpen((current) => !current)}
          aria-expanded={isFilterSidebarOpen}
          aria-controls="explorer-filter-sidebar"
        >
          Filters
          <span data-testid="explorer-filters-active-count">{activeFilterCount}</span>
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
                    distanceFilterCenter={filters.distanceCenter}
                    distanceFilterRadiusKm={filters.distanceCenter ? filters.distanceRadiusKm : null}
                    onMapBackgroundClick={handleDistanceCenterChange}
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

                <button
                  type="button"
                  data-testid="explorer-detail-favorite-button"
                  className="explorer-detail-favorite-button"
                  aria-pressed={favoritePlaceIds.has(selectedPlace.id)}
                  disabled={favoriteMutationIds.has(selectedPlace.id)}
                  onClick={() => {
                    void toggleFavorite(selectedPlace.id)
                  }}
                >
                  {favoritePlaceIds.has(selectedPlace.id) ? '★ Saved to Shortlist' : '☆ Save to Shortlist'}
                </button>

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
                          <p>{highlightReviewKeyword(truncateReviewText(review.text), filters.reviewKeyword)}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No reviews available.</p>
                  )}
                </div>

                {shouldShowExternalSearchActions ? (
                  <div className="explorer-detail-actions">
                    <a
                      data-testid="explorer-detail-action-open-google-maps"
                      href={selectedPlaceGoogleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="explorer-detail-action-button"
                    >
                      <span aria-hidden="true" className="explorer-detail-action-icon">
                        <svg viewBox="0 0 24 24">
                          <path d="M12 2c-3.31 0-6 2.69-6 6 0 4.35 6 12 6 12s6-7.65 6-12c0-3.31-2.69-6-6-6Zm0 8.5A2.5 2.5 0 1 1 12 5.5a2.5 2.5 0 0 1 0 5Z" />
                        </svg>
                      </span>
                      <span>Open in Google Maps</span>
                    </a>
                    <a
                      data-testid="explorer-detail-action-view-photos-google-maps"
                      href={selectedPlaceGoogleMapsPhotosUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="explorer-detail-action-button"
                    >
                      <span aria-hidden="true" className="explorer-detail-action-icon">
                        <svg viewBox="0 0 24 24">
                          <path d="M4 4h16v16H4V4Zm2 2v12h12V6H6Zm3 8 2.5-3 2 2 1.5-2L18 15H6l3-1Zm-.5-4.5A1.5 1.5 0 1 0 8.5 12a1.5 1.5 0 0 0 0-3Z" />
                        </svg>
                      </span>
                      <span>View photos on Google Maps</span>
                    </a>
                    <a
                      data-testid="explorer-detail-action-search-booking"
                      href={selectedPlaceBookingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="explorer-detail-action-button"
                    >
                      <span aria-hidden="true" className="explorer-detail-action-icon">
                        <svg viewBox="0 0 24 24">
                          <path d="M4 3h16v18H4V3Zm2 2v14h12V5H6Zm2 2h2v2H8V7Zm0 4h2v2H8v-2Zm0 4h2v2H8v-2Zm4-8h2v2h-2V7Zm0 4h2v2h-2v-2Zm0 4h2v2h-2v-2Z" />
                        </svg>
                      </span>
                      <span>Search on Booking.com</span>
                    </a>
                    <a
                      data-testid="explorer-detail-action-search-airbnb"
                      href={selectedPlaceAirbnbUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="explorer-detail-action-button"
                    >
                      <span aria-hidden="true" className="explorer-detail-action-icon">
                        <svg viewBox="0 0 24 24">
                          <path d="M12 3 3 10v11h6v-6h6v6h6V10l-9-7Zm0 2.5 7 5.44V19h-2v-6H7v6H5v-8.06L12 5.5Z" />
                        </svg>
                      </span>
                      <span>Search on Airbnb</span>
                    </a>
                  </div>
                ) : null}
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
                          disabled={favoriteMutationIds.has(place.id)}
                          onClick={(event) => {
                            event.stopPropagation()
                            void toggleFavorite(place.id)
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

        {isFilterSidebarOpen ? (
          <aside
            id="explorer-filter-sidebar"
            className="explorer-filter-sidebar"
            data-testid="explorer-filter-sidebar"
          >
            <div className="explorer-filter-sidebar-header">
              <h2>Filters</h2>
              <button
                type="button"
                data-testid="explorer-filter-reset"
                className="explorer-filter-reset-button"
                onClick={resetFilters}
                disabled={activeFilterCount === 0}
              >
                Reset
              </button>
            </div>

            <section className="explorer-filter-group" data-testid="explorer-filter-rating-group">
              <h3>Rating</h3>
              <p className="explorer-filter-helper">{filters.ratingMin.toFixed(1)} to {filters.ratingMax.toFixed(1)}</p>
              <label htmlFor="explorer-filter-rating-min">Minimum rating</label>
              <input
                id="explorer-filter-rating-min"
                data-testid="explorer-filter-rating-min"
                type="range"
                min={RATING_FILTER_MIN}
                max={RATING_FILTER_MAX}
                step={0.1}
                value={filters.ratingMin}
                onChange={(event) => handleRatingMinChange(Number(event.target.value))}
              />
              <label htmlFor="explorer-filter-rating-max">Maximum rating</label>
              <input
                id="explorer-filter-rating-max"
                data-testid="explorer-filter-rating-max"
                type="range"
                min={RATING_FILTER_MIN}
                max={RATING_FILTER_MAX}
                step={0.1}
                value={filters.ratingMax}
                onChange={(event) => handleRatingMaxChange(Number(event.target.value))}
              />
            </section>

            <section className="explorer-filter-group" data-testid="explorer-filter-category-group">
              <h3>Category</h3>
              <div className="explorer-filter-checkbox-grid">
                {EXPLORER_CATEGORY_OPTIONS.map((categoryOption) => (
                  <label key={categoryOption.id}>
                    <input
                      data-testid={`explorer-filter-category-${categoryOption.id}`}
                      type="checkbox"
                      checked={filters.categories.includes(categoryOption.id)}
                      onChange={() => handleCategoryFilterToggle(categoryOption.id)}
                    />
                    {categoryOption.label}
                  </label>
                ))}
              </div>
            </section>

            <section className="explorer-filter-group" data-testid="explorer-filter-website-group">
              <h3>Website</h3>
              <div className="explorer-filter-radio-grid">
                <label>
                  <input
                    data-testid="explorer-filter-website-all"
                    type="radio"
                    name="explorer-website-filter"
                    checked={filters.website === 'all'}
                    onChange={() => handleWebsiteFilterChange('all')}
                  />
                  All
                </label>
                <label>
                  <input
                    data-testid="explorer-filter-website-direct"
                    type="radio"
                    name="explorer-website-filter"
                    checked={filters.website === 'direct'}
                    onChange={() => handleWebsiteFilterChange('direct')}
                  />
                  Direct Booking
                </label>
                <label>
                  <input
                    data-testid="explorer-filter-website-ota"
                    type="radio"
                    name="explorer-website-filter"
                    checked={filters.website === 'ota'}
                    onChange={() => handleWebsiteFilterChange('ota')}
                  />
                  OTA
                </label>
                <label>
                  <input
                    data-testid="explorer-filter-website-unknown"
                    type="radio"
                    name="explorer-website-filter"
                    checked={filters.website === 'unknown'}
                    onChange={() => handleWebsiteFilterChange('unknown')}
                  />
                  Unknown
                </label>
              </div>
            </section>

            <section className="explorer-filter-group" data-testid="explorer-filter-review-keyword-group">
              <h3>Review keyword</h3>
              <label htmlFor="explorer-filter-review-keyword">Keyword</label>
              <input
                id="explorer-filter-review-keyword"
                data-testid="explorer-filter-review-keyword"
                type="search"
                placeholder="e.g. quiet, pool, breakfast"
                value={filters.reviewKeyword}
                onChange={(event) => handleReviewKeywordChange(event.target.value)}
              />
            </section>

            <section className="explorer-filter-group" data-testid="explorer-filter-distance-group">
              <h3>Distance</h3>
              <p data-testid="explorer-filter-distance-center" className="explorer-filter-helper">
                {distanceCenterLabel}
              </p>
              <p className="explorer-filter-note">Click anywhere on the map to set the center point.</p>
              {filters.distanceCenter ? (
                <>
                  <label htmlFor="explorer-filter-distance-radius">Radius: {filters.distanceRadiusKm} km</label>
                  <input
                    id="explorer-filter-distance-radius"
                    data-testid="explorer-filter-distance-radius"
                    type="range"
                    min={DISTANCE_FILTER_MIN_KM}
                    max={DISTANCE_FILTER_MAX_KM}
                    step={1}
                    value={filters.distanceRadiusKm}
                    onChange={(event) => handleDistanceRadiusChange(Number(event.target.value))}
                  />
                  <button
                    type="button"
                    data-testid="explorer-filter-distance-clear"
                    className="explorer-filter-clear-button"
                    onClick={clearDistanceCenter}
                  >
                    Clear distance point
                  </button>
                </>
              ) : null}
            </section>
          </aside>
        ) : null}
      </section>
    </main>
  )
}

interface PlaceMarkerControllerProps {
  places: Place[]
  selectedPlaceId: string | null
  onSelectPlace: (placeId: string | null) => void
  distanceFilterCenter: { lat: number; lng: number } | null
  distanceFilterRadiusKm: number | null
  onMapBackgroundClick: (center: { lat: number; lng: number }) => void
  onMarkerDebugSnapshot?: (entries: MarkerDebugEntry[]) => void
  onClusterDebugSnapshot?: (snapshot: ClusterDebugSnapshot) => void
  onSelectionCircleDebugSnapshot?: (snapshot: SelectionCircleDebugSnapshot) => void
}

function PlaceMarkerController({
  places,
  selectedPlaceId,
  onSelectPlace,
  distanceFilterCenter,
  distanceFilterRadiusKm,
  onMapBackgroundClick,
  onMarkerDebugSnapshot,
  onClusterDebugSnapshot,
  onSelectionCircleDebugSnapshot,
}: PlaceMarkerControllerProps) {
  const map = useMap()
  const markersRef = useRef(new globalThis.Map<string, google.maps.Marker>())
  const clustererRef = useRef<MarkerClusterer | null>(null)
  const selectionCircleRef = useRef<google.maps.Circle | null>(null)
  const distanceCircleRef = useRef<google.maps.Circle | null>(null)
  const distanceMarkerRef = useRef<google.maps.Marker | null>(null)
  const onSelectRef = useRef(onSelectPlace)
  const onMapBackgroundClickRef = useRef(onMapBackgroundClick)
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
    onMapBackgroundClickRef.current = onMapBackgroundClick
  }, [onMapBackgroundClick])

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

    const clickListener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (event.latLng) {
        onMapBackgroundClickRef.current({
          lat: event.latLng.lat(),
          lng: event.latLng.lng(),
        })
      }
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

  useEffect(() => {
    if (!map) {
      return
    }

    if (!distanceFilterCenter || distanceFilterRadiusKm === null) {
      if (distanceCircleRef.current) {
        distanceCircleRef.current.setMap(null)
        distanceCircleRef.current = null
      }

      if (distanceMarkerRef.current) {
        distanceMarkerRef.current.setMap(null)
        distanceMarkerRef.current = null
      }

      return
    }

    const marker = distanceMarkerRef.current
      ?? new google.maps.Marker({
        map,
        zIndex: 1090,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: '#5cabff',
          fillOpacity: 1,
          strokeColor: '#e4f2ff',
          strokeWeight: 2,
        },
        title: 'Distance filter center',
      })
    distanceMarkerRef.current = marker
    marker.setPosition(distanceFilterCenter)

    const circle = distanceCircleRef.current
      ?? new google.maps.Circle({
        map,
        strokeColor: '#59a8ff',
        strokeOpacity: 0.95,
        strokeWeight: 2,
        fillColor: '#4b95f1',
        fillOpacity: 0.14,
        clickable: false,
        zIndex: 1030,
      })
    distanceCircleRef.current = circle
    circle.setCenter(distanceFilterCenter)
    circle.setRadius(distanceFilterRadiusKm * 1000)
  }, [distanceFilterCenter, distanceFilterRadiusKm, map])

  useEffect(() => () => {
    for (const marker of markersRef.current.values()) {
      marker.setMap(null)
    }
    markersRef.current.clear()
    if (selectionCircleRef.current) {
      selectionCircleRef.current.setMap(null)
      selectionCircleRef.current = null
    }
    if (distanceCircleRef.current) {
      distanceCircleRef.current.setMap(null)
      distanceCircleRef.current = null
    }
    if (distanceMarkerRef.current) {
      distanceMarkerRef.current.setMap(null)
      distanceMarkerRef.current = null
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

const buildPlaceLocationLabel = (place: Place | null): string => {
  if (place === null) {
    return ''
  }

  const addressLabel = (place.address ?? '').trim()
  if (addressLabel.length > 0) {
    return addressLabel
  }

  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
    return ''
  }

  return `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`
}

const hasPlaceSearchContext = (place: Place | null): boolean => {
  if (place === null) {
    return false
  }

  return place.name.trim().length > 0 && buildPlaceLocationLabel(place).length > 0
}

const buildPlaceSearchLabel = (place: Place | null): string => {
  if (!hasPlaceSearchContext(place) || place === null) {
    return ''
  }

  return `${place.name.trim()}, ${buildPlaceLocationLabel(place)}`
}

const buildBookingSearchUrl = (searchLabel: string): string =>
  `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(searchLabel)}`

const buildAirbnbSearchUrl = (searchLabel: string): string =>
  `https://www.airbnb.com/s/${encodeURIComponent(searchLabel)}/homes`

const DEFAULT_EXPLORER_FILTERS: ExplorerFilterState = {
  ratingMin: RATING_FILTER_MIN,
  ratingMax: RATING_FILTER_MAX,
  categories: [],
  website: 'all',
  reviewKeyword: '',
  distanceCenter: null,
  distanceRadiusKm: DEFAULT_DISTANCE_RADIUS_KM,
}

const parseExplorerFiltersFromSearchParams = (searchParams: URLSearchParams): ExplorerFilterState => {
  const parsedRatingMin = Number.parseFloat(searchParams.get(FILTER_PARAM_RATING_MIN) ?? '')
  const parsedRatingMax = Number.parseFloat(searchParams.get(FILTER_PARAM_RATING_MAX) ?? '')
  const parsedCategories = (searchParams.get(FILTER_PARAM_CATEGORIES) ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is ExplorerCategoryFilter => isExplorerCategoryFilter(entry))
  const parsedWebsite = searchParams.get(FILTER_PARAM_WEBSITE)
  const reviewKeyword = (searchParams.get(FILTER_PARAM_REVIEW_KEYWORD) ?? '').trim()
  const parsedDistanceLat = Number.parseFloat(searchParams.get(FILTER_PARAM_DISTANCE_LAT) ?? '')
  const parsedDistanceLng = Number.parseFloat(searchParams.get(FILTER_PARAM_DISTANCE_LNG) ?? '')
  const parsedDistanceRadius = Number.parseFloat(searchParams.get(FILTER_PARAM_DISTANCE_RADIUS_KM) ?? '')

  const ratingMin = Number.isFinite(parsedRatingMin)
    ? clamp(parsedRatingMin, RATING_FILTER_MIN, RATING_FILTER_MAX)
    : DEFAULT_EXPLORER_FILTERS.ratingMin
  const ratingMax = Number.isFinite(parsedRatingMax)
    ? clamp(parsedRatingMax, RATING_FILTER_MIN, RATING_FILTER_MAX)
    : DEFAULT_EXPLORER_FILTERS.ratingMax
  const distanceCenter = Number.isFinite(parsedDistanceLat) && Number.isFinite(parsedDistanceLng)
    ? {
        lat: parsedDistanceLat,
        lng: parsedDistanceLng,
      }
    : null

  return {
    ratingMin: Math.min(ratingMin, ratingMax),
    ratingMax: Math.max(ratingMin, ratingMax),
    categories: sortCategoryFilters(parsedCategories),
    website: FILTER_WEBSITE_OPTIONS.includes(parsedWebsite as ExplorerWebsiteFilter)
      ? parsedWebsite as ExplorerWebsiteFilter
      : DEFAULT_EXPLORER_FILTERS.website,
    reviewKeyword,
    distanceCenter,
    distanceRadiusKm: Number.isFinite(parsedDistanceRadius)
      ? clamp(parsedDistanceRadius, DISTANCE_FILTER_MIN_KM, DISTANCE_FILTER_MAX_KM)
      : DEFAULT_EXPLORER_FILTERS.distanceRadiusKm,
  }
}

const buildExplorerFilterSearchParams = (
  currentSearchParams: URLSearchParams,
  filters: ExplorerFilterState,
): URLSearchParams => {
  const nextSearchParams = new URLSearchParams(currentSearchParams)

  nextSearchParams.delete(FILTER_PARAM_RATING_MIN)
  nextSearchParams.delete(FILTER_PARAM_RATING_MAX)
  nextSearchParams.delete(FILTER_PARAM_CATEGORIES)
  nextSearchParams.delete(FILTER_PARAM_WEBSITE)
  nextSearchParams.delete(FILTER_PARAM_REVIEW_KEYWORD)
  nextSearchParams.delete(FILTER_PARAM_DISTANCE_LAT)
  nextSearchParams.delete(FILTER_PARAM_DISTANCE_LNG)
  nextSearchParams.delete(FILTER_PARAM_DISTANCE_RADIUS_KM)

  if (filters.ratingMin > RATING_FILTER_MIN) {
    nextSearchParams.set(FILTER_PARAM_RATING_MIN, filters.ratingMin.toFixed(1))
  }

  if (filters.ratingMax < RATING_FILTER_MAX) {
    nextSearchParams.set(FILTER_PARAM_RATING_MAX, filters.ratingMax.toFixed(1))
  }

  if (filters.categories.length > 0) {
    nextSearchParams.set(FILTER_PARAM_CATEGORIES, filters.categories.join(','))
  }

  if (filters.website !== DEFAULT_EXPLORER_FILTERS.website) {
    nextSearchParams.set(FILTER_PARAM_WEBSITE, filters.website)
  }

  const trimmedReviewKeyword = filters.reviewKeyword.trim()
  if (trimmedReviewKeyword.length > 0) {
    nextSearchParams.set(FILTER_PARAM_REVIEW_KEYWORD, trimmedReviewKeyword)
  }

  if (filters.distanceCenter) {
    nextSearchParams.set(FILTER_PARAM_DISTANCE_LAT, filters.distanceCenter.lat.toFixed(6))
    nextSearchParams.set(FILTER_PARAM_DISTANCE_LNG, filters.distanceCenter.lng.toFixed(6))
    nextSearchParams.set(FILTER_PARAM_DISTANCE_RADIUS_KM, String(filters.distanceRadiusKm))
  }

  return nextSearchParams
}

const placeMatchesExplorerFilters = (
  place: Place,
  filters: ExplorerFilterState,
  reviewsByPlaceId: Record<string, PlaceReview[]>,
): boolean => {
  if (!placeMatchesRatingFilter(place, filters)) {
    return false
  }

  if (!placeMatchesCategoryFilter(place, filters.categories)) {
    return false
  }

  if (!placeMatchesWebsiteFilter(place, filters.website)) {
    return false
  }

  if (!placeMatchesReviewKeywordFilter(place, filters.reviewKeyword, reviewsByPlaceId)) {
    return false
  }

  if (!placeMatchesDistanceFilter(place, filters.distanceCenter, filters.distanceRadiusKm)) {
    return false
  }

  return true
}

const placeMatchesRatingFilter = (place: Place, filters: ExplorerFilterState): boolean => {
  if (place.rating === null) {
    return filters.ratingMin === RATING_FILTER_MIN && filters.ratingMax === RATING_FILTER_MAX
  }

  return place.rating >= filters.ratingMin && place.rating <= filters.ratingMax
}

const placeMatchesCategoryFilter = (place: Place, selectedCategories: ExplorerCategoryFilter[]): boolean => {
  if (selectedCategories.length === 0) {
    return true
  }

  const category = normalizeCategoryFilter(place.category)
  if (!category) {
    return false
  }

  return selectedCategories.includes(category)
}

const placeMatchesWebsiteFilter = (place: Place, websiteFilter: ExplorerWebsiteFilter): boolean => {
  if (websiteFilter === 'all') {
    return true
  }

  return place.websiteType === websiteFilter
}

const placeMatchesReviewKeywordFilter = (
  place: Place,
  reviewKeyword: string,
  reviewsByPlaceId: Record<string, PlaceReview[]>,
): boolean => {
  const normalizedKeyword = reviewKeyword.trim().toLowerCase()
  if (!normalizedKeyword) {
    return true
  }

  const placeReviews = reviewsByPlaceId[place.id] ?? []
  if (placeReviews.length === 0) {
    return false
  }

  return placeReviews.some((review) => review.text.toLowerCase().includes(normalizedKeyword))
}

const placeMatchesDistanceFilter = (
  place: Place,
  distanceCenter: { lat: number; lng: number } | null,
  distanceRadiusKm: number,
): boolean => {
  if (!distanceCenter) {
    return true
  }

  return distanceInKilometers(distanceCenter, { lat: place.lat, lng: place.lng }) <= distanceRadiusKm
}

const normalizeCategoryFilter = (category: string | null): ExplorerCategoryFilter | null => {
  if (!category) {
    return null
  }

  const normalized = category.trim().toLowerCase()

  if (normalized.includes('hotel')) {
    return 'hotel'
  }

  if (normalized.includes('vacation rental') || normalized.includes('holiday home') || normalized.includes('villa')) {
    return 'vacation-rental'
  }

  if (normalized.includes('b&b') || normalized.includes('bed and breakfast') || normalized.includes('guest house')) {
    return 'bed-breakfast'
  }

  if (normalized.includes('apartment') || normalized.includes('flat') || normalized.includes('condo')) {
    return 'apartment'
  }

  return null
}

const countActiveFilters = (filters: ExplorerFilterState): number => {
  let count = filters.categories.length

  if (filters.ratingMin > RATING_FILTER_MIN) {
    count += 1
  }

  if (filters.ratingMax < RATING_FILTER_MAX) {
    count += 1
  }

  if (filters.website !== DEFAULT_EXPLORER_FILTERS.website) {
    count += 1
  }

  if (filters.reviewKeyword.trim().length > 0) {
    count += 1
  }

  if (filters.distanceCenter) {
    count += 1
  }

  return count
}

const sortCategoryFilters = (categories: ExplorerCategoryFilter[]): ExplorerCategoryFilter[] => {
  const uniqueCategories = Array.from(new Set(categories))

  return EXPLORER_CATEGORY_OPTIONS
    .map((option) => option.id)
    .filter((id) => uniqueCategories.includes(id))
}

const areFilterStatesEqual = (left: ExplorerFilterState, right: ExplorerFilterState): boolean =>
  left.ratingMin === right.ratingMin
  && left.ratingMax === right.ratingMax
  && left.website === right.website
  && left.reviewKeyword === right.reviewKeyword
  && left.distanceRadiusKm === right.distanceRadiusKm
  && areDistanceCentersEqual(left.distanceCenter, right.distanceCenter)
  && left.categories.length === right.categories.length
  && left.categories.every((value, index) => value === right.categories[index])

const areDistanceCentersEqual = (
  left: { lat: number; lng: number } | null,
  right: { lat: number; lng: number } | null,
): boolean => {
  if (left === null || right === null) {
    return left === right
  }

  return left.lat === right.lat && left.lng === right.lng
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const isExplorerCategoryFilter = (value: string): value is ExplorerCategoryFilter =>
  EXPLORER_CATEGORY_OPTIONS.some((option) => option.id === value)

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

const formatDistanceCenter = (center: { lat: number; lng: number } | null): string => {
  if (!center) {
    return 'No center point selected.'
  }

  return `Center: ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`
}

const highlightReviewKeyword = (text: string, reviewKeyword: string): ReactNode => {
  const normalizedKeyword = reviewKeyword.trim()
  if (!normalizedKeyword) {
    return text
  }

  const escapedKeyword = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(${escapedKeyword})`, 'ig')
  const segments = text.split(pattern)

  return segments.map((segment, index) =>
    segment.toLowerCase() === normalizedKeyword.toLowerCase()
      ? <mark key={`${segment}-${index}`} className="explorer-review-highlight">{segment}</mark>
      : <span key={`${segment}-${index}`}>{segment}</span>
  )
}

const distanceInKilometers = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number => {
  const earthRadiusKm = 6371
  const latDelta = toRadians(to.lat - from.lat)
  const lngDelta = toRadians(to.lng - from.lng)
  const fromLatRadians = toRadians(from.lat)
  const toLatRadians = toRadians(to.lat)

  const haversine =
    (Math.sin(latDelta / 2) ** 2)
    + Math.cos(fromLatRadians) * Math.cos(toLatRadians) * (Math.sin(lngDelta / 2) ** 2)

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine))
}

const toRadians = (value: number): number => value * (Math.PI / 180)

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
