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
    │  Scrape  │  │  SQLite  │  │  Scraper  │
    │  Planner │  │    DB    │  │  Engine   │
    │ (tiling) │  │          │  │(Playwright)│
    └──────────┘  └──────────┘  └───────────┘
```

### Tech stack

- **Frontend:** React + TypeScript, Google Maps JavaScript API (embedded)
- **Backend:** Node.js server (Express), serves REST API + static frontend build
- **Scraper:** Playwright (Chromium), single browser tab, runs as background process triggered via API
- **Storage:** SQLite
- **Google Maps API key:** Required. User provides their own key via `.env`. The free tier ($200/month credit) is more than sufficient for personal use.

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

## 5. Adaptive Tiling Algorithm

The tool decides tile size automatically. The user never configures tile dimensions.

### Strategy

```
1. Start with a coarse grid (tiles ≈ 0.1° — roughly 10km).
2. For each tile (processed sequentially, one browser tab):
   a. Navigate Google Maps to the tile's center at an appropriate zoom level.
   b. Execute the search query.
   c. Scroll the results panel to exhaustion (no new results appearing).
   d. Collect all place URLs.
   e. IF result count hits Google's display cap (~120 places):
      → This tile likely has undiscovered places.
      → Subdivide into 4 smaller sub-tiles.
      → Queue sub-tiles for processing.
   f. IF result count < cap:
      → Tile is complete — all places in this area captured.
3. De-duplicate places across all tiles by canonical Google Maps URL.
4. Enforce a minimum tile size floor (e.g., 0.01° ≈ 1km) to prevent
   infinite recursion in extremely dense areas.
```

### Why this works

Google Maps search caps visible results at approximately 120 places per viewport. If a tile returns that many, there are likely more places not shown — so we zoom in (subdivide). If it returns fewer, we've captured everything in that area.

---

## 6. Data Model

### Place

```
Place {
  id                      (hash of canonical Google Maps URL)
  googleUrl               (canonical URL)
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

## 7. Scraper Engine

### Per-place data extraction

For each discovered place URL, the scraper opens the detail page and extracts:

| Field | Source | Notes |
|---|---|---|
| name | `h1` heading | |
| category | Category button/link | "Hotel", "Vacation rental", etc. |
| rating | Rating display element | Numeric, 1.0–5.0 |
| reviewCount | Reviews button aria-label | Parsed from "X reviews" |
| priceLevel | Price level indicator | "$"–"$$$$", if displayed |
| phone | Phone button | |
| website | Website/authority link | |
| address | Address button | |
| lat, lng | Parsed from page URL | `/@lat,lng,...` pattern |
| photoUrls | Photo carousel | First N image URLs |
| openingHours | Hours section | Text representation |
| amenities | Amenities/About section | Best-effort list extraction |
| reviews | Reviews tab | Text + individual rating, capped by `reviewLimit` |

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

- **Sequential processing:** One browser tab at a time. One tile, then one place detail page at a time.
- **Randomized delays:** Configurable base delay (default: 1500ms) plus random jitter (200–600ms) between page loads.
- **Persistent browser profile:** Chromium profile stored per project. Cookies and session persist across runs.
- **CAPTCHA handling:** If a challenge page is detected, the scrape pauses and the UI notifies the user to solve it manually in the browser window, then continue.
- **Checkpoint/resume:** Progress is saved after every tile and every place detail scrape. If interrupted, resume picks up at the next unfinished tile/place.
- **Language:** Whatever Google serves based on the browser's locale. No forced language override.

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

- **Google Maps API key:** Required for the embedded map UI. User provides via `.env`. Free tier ($200/month) sufficient for personal use.
- **No Google login required** for scraping. The scraper operates as an anonymous browser session.
- **Performance:** SQLite with proper indexes. UI handles 5,000+ places without lag via virtual scrolling and marker clustering.
- **Resilience:** Checkpoint after every tile and every place. Graceful pause/resume. No data loss on crash.
- **Privacy:** All data stored locally. No external services beyond Google Maps (scraping + API).
- **Single user:** This is a personal tool, not multi-tenant. No auth needed.

---

## 11. Future Considerations (Out of Scope for v1)

- Parallel scraping (multiple browser tabs)
- Automatic price comparison with OTA APIs
- Email/notification when scrape completes
- Cloud deployment / shared access
- Mobile-responsive UI
- Automatic CAPTCHA solving
