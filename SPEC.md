# GoMaps — Product Specification v1.0

## 1. Vision

A personal accommodation discovery tool that scrapes Google Maps comprehensively across a user-defined area, collects rich place data (details, reviews, amenities, pricing), and presents results in an interactive Google Maps-based UI for filtering, comparison, and direct-booking discovery.

**Primary use case:** A user planning a family vacation wants to find accommodation beyond what Booking.com and Airbnb surface — and for places that do appear on OTAs, find the property's own website to book directly at a lower price.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────┐
│                  React Web App                       │
│                  (localhost)                          │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Scrape Setup  │  │  Explorer    │  │  Compare / │ │
│  │ (Google Maps  │  │ (Map+Table)  │  │  Shortlist │ │
│  │  embedded)    │  │              │  │            │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
│         │                 │                 │        │
│         └─────────────┬───┘─────────────────┘        │
│                       │                              │
│                REST API Layer                        │
└───────────────────────┬──────────────────────────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
    ┌────▼─────┐  ┌─────▼────┐  ┌─────▼─────┐
    │  Area    │  │  SQLite  │  │  Places   │
    │  Tiling  │  │    DB    │  │  API      │
    │          │  │          │  │  Client   │
    └──────────┘  └──────────┘  └───────────┘
```

### Tech stack

- **Frontend:** React + TypeScript, Google Maps JavaScript API (embedded)
- **Backend:** Node.js server (Express), serves REST API + static frontend build
- **Data Fetching:** Google Places API (New) — Text Search and Place Details endpoints, called server-side via HTTP
- **Storage:** SQLite
- **Google Maps API key:** Required. User provides their own key via `.env`. The Places API (New) has generous free usage thresholds per SKU (e.g., 5,000 free Text Search Pro requests/month, 10,000 free Place Details Essentials/month). For personal vacation planning, usage stays well within free tiers.

---

## 3. Core Concepts

### 3.1 Projects

A **Project** is a named container for scraping work in a geographic region.

- Has a name (e.g., *"Sardinia Summer 2026"*)
- Has a geographic bounding box (defined visually on the map)
- Contains one or more **Scrape Runs** (each with a different query)
- Has a unified result set: all runs merged, places de-duplicated
- The user can run multiple queries against the same area — *"vacation rentals"*, *"agriturismi"*, *"hotel with pool"* — and explore all results together

### 3.2 Scrape Runs

A **Scrape Run** belongs to a project and represents one query execution:

- Query text (e.g., `"vacation rentals garden"`)
- Status: `pending` → `running` → `completed` / `paused` / `failed`
- Progress: tiles completed / total, places found, estimated time remaining
- Timestamps (started, completed)

### 3.3 Re-scraping

Places can become stale. The tool supports re-scraping:

- Each place record has a `scrapedAt` timestamp.
- The user can trigger a **re-scrape** for a project, which revisits the detail pages of all existing places to refresh their data (rating, review count, reviews, price, website, etc.).
- The re-scrape reuses the existing place list — it does not re-tile the area or re-discover places (unless the user explicitly starts a new Scrape Run).
- In the Explorer UI, places with data older than a configurable threshold (default: 7 days) show a subtle "stale" indicator.

---

## 4. Scrape Setup View

An embedded **Google Maps** view (using the Maps JavaScript API) where the user interactively defines what to scrape.

### Workflow

1. **Navigate freely** — pan, zoom, use Google Maps search — the full native experience.
2. **Define the scrape area** — click a "Select Area" button, then the current viewport becomes the bounding box. The user can adjust the rectangle with drag handles to fine-tune.
3. **See prior coverage** — tiles from previous scrape runs are overlaid as a semi-transparent grid:
   - 🟢 Green = scraped (complete)
   - 🟡 Yellow = in-progress
   - ⚪ Gray = planned
4. **Enter query** — a search input above the map for the text query.
5. **See estimates** — before starting, the UI shows:
   - Estimated tile count
   - Estimated scrape time (based on area size and historical speed)
   - Warning if the area is very large
6. **Start scrape** — "Start Scrape" button. The scrape runs in the background. The user can navigate to the Explorer view, close the tab and come back, or start another scrape in a different project.

### Live progress

While a scrape is running, the Setup view shows:

```
Tiles: 34/52 (12 subdivided)
Places found: 847 (723 unique)
Elapsed: 12m 34s — Est. remaining: ~8m
```

The tile overlay on the map updates in real time as tiles complete.

---

## 5. Area Coverage via Tiled API Queries

The tool tiles the user-defined bounding box to ensure comprehensive coverage via the Google Places API (New).

### Strategy

```
1. Start with a coarse grid (tiles ≈ 0.1° — roughly 10km).
2. For each tile:
   a. Call Text Search API with the query, using locationBias set to
      the tile's center + radius covering the tile area.
   b. Paginate via nextPageToken (up to 60 results per tile, 20 per page).
   c. IF result count hits the API page limit (60 places):
      → This tile likely has undiscovered places.
      → Subdivide into 4 smaller sub-tiles.
      → Queue sub-tiles for processing.
   d. IF result count < 60:
      → Tile is complete — all places in this area captured.
3. De-duplicate places across all tiles by Google Place ID.
4. Enforce a minimum tile size floor (e.g., 0.01° ≈ 1km) to prevent
   infinite recursion in extremely dense areas.
5. For each discovered place, call Place Details API to fetch
   enriched data (reviews, photos, amenities, etc.) if not already
   returned by Text Search.
```

### Why this works

The Text Search API returns up to 20 results per request (60 with pagination). By tiling the area and using locationBias, we ensure comprehensive spatial coverage. Subdivision handles dense areas the same way the browser-based approach did, but via reliable API calls instead of fragile browser scraping.

---

## 6. Data Model

### Place

```
Place {
  id                      (Google Place ID, e.g., "ChIJ...")
  googleMapsUri           (canonical Google Maps URL)
  name
  category                ("Hotel", "Vacation rental", "Guest house", ...)
  rating                  (1.0–5.0, nullable)
  reviewCount             (nullable)
  priceLevel              ("$"–"$$$$", nullable)
  phone                   (nullable)
  website                 (nullable)
  websiteType             ("direct" | "ota" | "social" | "unknown")
  address                 (nullable)
  lat
  lng
  photoUrls[]             (URLs only, not downloaded)
  openingHours            (nullable, text)
  amenities[]             (best-effort: pool, WiFi, parking, AC, etc.)
  scrapedAt               (ISO timestamp)
}
```

### Review

```
Review {
  id
  placeId                 (FK → Place)
  rating                  (1–5, individual review star rating)
  text
  relativeDate            ("2 months ago", as displayed by Google)
}
```

### Tile

```
Tile {
  id
  scrapeRunId             (FK → ScrapeRun)
  bounds                  {sw: [lat, lng], ne: [lat, lng]}
  zoomLevel
  status                  (pending | running | completed | subdivided)
  resultCount
  parentTileId            (nullable, for subdivided tiles)
}
```

### Project & Run

```
Project {
  id
  name
  bounds                  {sw: [lat, lng], ne: [lat, lng]}
  createdAt
}

ScrapeRun {
  id
  projectId               (FK → Project)
  query
  status                  (pending | running | paused | completed | failed)
  tilesTotal
  tilesCompleted
  tilesSubdivided
  placesFound
  placesUnique
  startedAt
  completedAt
}

PlaceScrapeRun {           (junction: which runs discovered which places)
  placeId
  scrapeRunId
}
```

### Shortlist

```
Shortlist {
  id
  projectId               (FK → Project)
  name                    ("Top picks", "Budget options")
}

ShortlistEntry {
  shortlistId             (FK → Shortlist)
  placeId                 (FK → Place)
  notes                   (user's personal free-text notes)
}
```

---

## 7. Places API Data Fetching

### Data retrieval strategy

Data is fetched using the Google Places API (New), which provides structured JSON responses. Two main endpoints are used:

1. **Text Search (New):** Discovers places matching a query within a geographic area. Called server-side via HTTP POST to `https://places.googleapis.com/v1/places:searchText`. Returns up to 20 results per page (60 with pagination). Fields requested via the `X-Goog-FieldMask` header determine the SKU tier and cost.

2. **Place Details (New):** Fetches enriched data for individual places. Called server-side via HTTP GET to `https://places.googleapis.com/v1/places/{placeId}`. Used for fields not returned by Text Search (e.g., full reviews, photos).

### Fields and mapping

| Field | API Source | Places API field |
|---|---|---|
| name | Text Search | `displayName.text` |
| category | Text Search | `primaryTypeDisplayName.text` or `types[]` |
| rating | Text Search | `rating` |
| reviewCount | Text Search | `userRatingCount` |
| priceLevel | Text Search | `priceLevel` (PRICE_LEVEL_INEXPENSIVE → "$", etc.) |
| phone | Text Search / Details | `internationalPhoneNumber` |
| website | Text Search / Details | `websiteUri` |
| address | Text Search | `formattedAddress` |
| lat, lng | Text Search | `location.latitude`, `location.longitude` |
| photoUrls | Details | `photos[].name` → Photo API URL |
| openingHours | Text Search / Details | `regularOpeningHours.weekdayDescriptions[]` |
| amenities | Details | Not directly available — best-effort from `types[]` and `editorialSummary` |
| reviews | Details | `reviews[]` with `rating`, `text.text`, `relativePublishTimeDescription` |
| googleMapsUri | Text Search | `googleMapsUri` — canonical Google Maps URL |

### Website classification (Direct Booking Detection)

When a place has a `website` field, classify the domain:

| Type | Detection | Examples |
|---|---|---|
| `direct` | Domain not in known OTA/platform list | `www.hotel-sardinia.it`, `villarosemary.com` |
| `ota` | Domain matches known OTA list | `booking.com`, `airbnb.com`, `expedia.com`, `hotels.com`, `vrbo.com`, `agoda.com`, `tripadvisor.com`, `hostelworld.com` |
| `social` | Domain is social media | `facebook.com`, `instagram.com`, `twitter.com` |
| `unknown` | Cannot determine | |

Detection is a simple domain-matching heuristic against a hardcoded allowlist (~20–30 OTA domains). The list can be extended easily.

In the Explorer UI, places with `websiteType: "direct"` display a prominent **"Book Direct" badge**.

### Operational behavior

- **Server-side HTTP calls:** All Places API requests are made from the Express server using the Google Maps API key. No browser required.
- **Rate limiting:** Respect API quotas. Add configurable delay between requests (default: 200ms) to avoid hitting rate limits.
- **Checkpoint/resume:** Progress is saved after every tile and every place detail fetch. If interrupted, resume picks up at the next unfinished tile/place.
- **De-duplication:** Places are de-duplicated by Google Place ID (`places/{placeId}`). The same place discovered in overlapping tiles is stored once.
- **Cost awareness:** Use field masks to request only needed fields, minimizing SKU tier charges. Text Search with basic+pro fields handles most data; Place Details only for reviews and photos.

---

## 8. Explorer UI

### 8.1 Layout

```
┌───────────────────────────────────────────────────────────┐
│ [Project ▾]  [Scrape Runs ▾]  [ 🔍 Search... ]  [Filters]│
├─────────────────────────────────┬─────────────────────────┤
│                                 │                         │
│      Google Maps View           │     Detail Panel        │
│      (scraped place markers     │     (selected place)    │
│       overlaid on Google Maps)  │                         │
│                                 │                         │
│                                 │                         │
├─────────────────────────────────┴─────────────────────────┤
│  Table View (sortable, filterable, virtual-scrolled)      │
│  Name | Category | Rating | Reviews | Price | Website |…  │
└───────────────────────────────────────────────────────────┘
```

Resizable split-pane layout. Map + detail panel on top, table on bottom.

### 8.2 Map View

- **Google Maps** embedded via JavaScript API — full interactivity including Street View, satellite toggle, native Google POIs visible and clickable for surrounding context.
- **Scraped place markers** overlaid as custom markers. Visual encoding (user-toggleable):
  - **By category:** Different icon/color per category (hotel, rental, B&B, etc.)
  - **By rating:** Red (< 3.5) → Yellow (3.5–4.2) → Green (> 4.2)
  - **By website type:** Green = has direct website, Orange = OTA, Gray = no website
- **Marker clustering** when zoomed out to handle thousands of markers.
- **Click marker** → highlights row in table + opens Detail Panel.
- **Scrape coverage overlay** (toggleable) — semi-transparent grid showing scraped tiles.

### 8.3 Table View

- Sortable, paginated, virtual-scrolled table (handles 5,000+ places).
- Columns: Name, Category, Rating, Review Count, Price Level, Website (linked, with Direct/OTA badge), Address, ⭐ (shortlist toggle).
- Click row → selects on map + opens Detail Panel.
- Inline quick-filter text input above the table (filters across all visible text columns).

### 8.4 Detail Panel

Appears on the right when a place is selected (from map or table).

**Contents:**
- Place name, category, rating (stars + count)
- Price level (if available)
- Address
- Phone (clickable `tel:` link)
- Website link with visual badge:
  - 🟢 **Book Direct** — links to property's own site
  - 🟠 **OTA** — links to Booking.com, Airbnb, etc.
  - ⚪ **No website**
- Amenities list (icons + labels)
- Photo URLs displayed as a clickable thumbnail strip (loaded on demand)
- Opening hours
- `scrapedAt` timestamp (with "stale" warning if old)

**Reviews section:**
- All collected reviews listed (rating + text)
- Searchable within the panel (keyword highlight)

**Action links:**
- "Open in Google Maps" (new tab, using the place's `googleUrl`)
- "Search on Booking.com" (auto-generated URL pre-filled with place name + location)
- "Search on Airbnb" (same)

### 8.5 Search & Filters

**Fuzzy text search bar** (top of page) — searches across:
- Place name
- Address
- Review text (find places where guests mention "pool", "garden", "quiet", "family")
- Category
- Amenities

**Filter panel** (collapsible, sidebar or dropdown):

| Filter | Control | Example |
|---|---|---|
| Rating | Range slider | 3.5 – 5.0 |
| Min. reviews | Slider / input | ≥ 10 |
| Category | Multi-select checkboxes | ☑ Hotel ☑ Vacation rental |
| Has website | Toggle | Yes / No / Any |
| Website type | Multi-select | ☑ Direct ☑ OTA |
| Price level | Multi-select | ☑ $ ☑ $$ |
| Amenities | Multi-select | ☑ Pool ☑ Parking ☑ WiFi |
| Review keyword | Text input | "clean", "breakfast" |
| Distance from point | Click map point + radius slider | Within 5km of [clicked point] |

All filters combine with AND logic. Both map markers and table update live as filters change.

### 8.6 Shortlists

- Any place can be ⭐ starred (from table, map popup, or detail panel).
- Multiple named shortlists per project (e.g., "Top picks", "Budget < €80", "Near beach").
- Shortlist view: shows only starred places, laid out for comparison.
- Side-by-side comparison of 2–3 shortlisted places (key fields in columns).
- User can add free-text notes to each shortlisted place.
- Export shortlist as CSV.

---

## 9. UX Flow Summary

```
User creates a Project
    │
    ▼
Scrape Setup View
    │  Navigate Google Maps, draw area, enter query
    │
    ▼
Scrape runs in background
    │  Adaptive tiling, sequential place scraping
    │  Live progress on map overlay
    │  CAPTCHA pause/resume if needed
    │
    ▼
Explorer View
    │  Map + Table + Detail Panel
    │  Search, filter, compare
    │  Star places into shortlists
    │
    ▼
User can:
    ├─ Start another Scrape Run (different query, same area)
    ├─ Re-scrape (refresh stale data)
    ├─ Export shortlist
    └─ Open places directly in Google Maps / Booking / Airbnb
```

---

## 10. Non-Functional Requirements

- **Google Maps API key:** Required for both the embedded map UI and Places API data fetching. User provides via `.env`. The Places API (New) uses per-SKU free thresholds: Text Search Pro has 5,000 free/month, Place Details Essentials has 10,000 free/month, Place Details Pro has 5,000 free/month. Personal vacation planning stays well within free tiers.
- **No browser/scraper required:** All data is fetched via Google Places API HTTP endpoints. No Playwright, no CAPTCHA risk.
- **Performance:** SQLite with proper indexes. UI handles 5,000+ places without lag via virtual scrolling and marker clustering.
- **Resilience:** Checkpoint after every tile and every place. Graceful pause/resume. No data loss on crash.
- **Privacy:** All data stored locally. Google Places API is the only external service.
- **Single user:** This is a personal tool, not multi-tenant. No auth needed.

---

## 11. Future Considerations (Out of Scope for v1)

- Parallel API requests (concurrent tile fetching)
- Automatic price comparison with OTA APIs
- Email/notification when scrape completes
- Cloud deployment / shared access
- Mobile-responsive UI
- Nearby Search API as alternative to Text Search for area-based queries
