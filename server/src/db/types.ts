export interface Project {
  id: string
  name: string
  bounds: string | null // JSON: { sw: [lat, lng], ne: [lat, lng] }
  createdAt: string
}

export interface ProjectSummary extends Project {
  status: 'draft' | 'running' | 'paused' | 'failed' | 'complete'
  activeRunId: string | null
  scrapeRunsCount: number
  placesCount: number
  lastScrapedAt: string | null
}

export interface ScrapeRun {
  id: string
  projectId: string
  query: string
  kind: 'discovery' | 'refresh'
  bounds: string | null
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  tilesTotal: number
  tilesCompleted: number
  tilesSubdivided: number
  placesFound: number
  placesUnique: number
  startedAt: string | null
  completedAt: string | null
}

export interface Tile {
  id: string
  scrapeRunId: string
  bounds: string // JSON: { sw: [lat, lng], ne: [lat, lng] }
  zoomLevel: number
  status: 'pending' | 'running' | 'completed' | 'subdivided'
  resultCount: number
  parentTileId: string | null
}

export interface Place {
  id: string
  googleMapsUri: string
  googleMapsPhotosUri: string | null
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
  photoUrls: string // JSON array
  openingHours: string | null
  amenities: string // JSON array
  scrapedAt: string
}

export interface Review {
  id: string
  placeId: string
  rating: number
  text: string
  relativeDate: string | null
}

export interface PlaceScrapeRun {
  placeId: string
  scrapeRunId: string
}

export interface Shortlist {
  id: string
  projectId: string
  name: string
}

export interface ShortlistEntry {
  shortlistId: string
  placeId: string
  notes: string
}
