# GoMaps — Development Guide

This guide structures the GoMaps specification (`SPEC.md`) into an ordered set of user stories designed for autonomous execution using the [Ralph loop pattern](https://ghuntley.com/ralph/).

## Approach

The project is built incrementally via a Ralph loop: an AI coding agent picks one user story per iteration, implements it, verifies it passes (typecheck, lint, tests, build), commits, and marks it done. Progress persists across iterations via git history, `progress.txt`, and `prd.json`.

### Key principles

1. **One story per iteration.** Each story is sized to fit in a single context window.
2. **Machine-verifiable acceptance criteria.** Every story has concrete checks: typecheck passes, tests pass, build succeeds, server starts, UI renders.
3. **State lives in files, not in memory.** `prd.json` tracks completion. `progress.txt` captures learnings. `AGENTS.md` captures conventions.
4. **Specs are the source of truth.** `SPEC.md` contains the full product specification. Stories reference it but don't duplicate it.

### How to run

```bash
# Option 1: Use the snarktank/ralph script
./ralph.sh [max_iterations]

# Option 2: Manual Ralph loop with Amp
while :; do amp -x < prompt.md; done
```

## Project structure (target)

```
gomaps/
├── AGENTS.md                  # Agent conventions, build/test commands
├── SPEC.md                    # Product specification (reference)
├── DEVELOPMENT.md             # This file
├── prd.json                   # Ralph PRD — story tracking
├── progress.txt               # Append-only learnings log
├── prompt.md                  # Ralph prompt template
│
├── server/                    # Express + SQLite backend
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts           # Server entry point
│   │   ├── db/
│   │   │   ├── schema.ts      # SQLite schema (drizzle or raw)
│   │   │   └── migrations/
│   │   ├── routes/
│   │   │   ├── projects.ts
│   │   │   ├── scrape.ts
│   │   │   ├── places.ts
│   │   │   └── shortlists.ts
│   │   └── scraper/
│   │       ├── engine.ts      # Playwright scraper
│   │       ├── tiling.ts      # Adaptive tiling algorithm
│   │       ├── extractor.ts   # Place detail extraction
│   │       └── classifier.ts  # Website classification
│   └── tests/
│
├── client/                    # React frontend
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── MapView.tsx
│       │   ├── TableView.tsx
│       │   ├── DetailPanel.tsx
│       │   ├── FilterPanel.tsx
│       │   ├── ScrapeSetup.tsx
│       │   └── Shortlists.tsx
│       ├── hooks/
│       └── lib/
│           └── api.ts         # API client
│
└── legacy/                    # Original MVP (preserved for reference)
    └── src/index.ts
```

## Phase overview

| Phase | Stories | What you get when done |
|-------|---------|----------------------|
| 1. Foundation | US-001 → US-004 | Monorepo, SQLite DB, Express API, React shell with Google Maps |
| 2. Scraper Core | US-005 → US-009 | Adaptive tiling scraper triggered via API with live progress |
| 3. Scrape Setup UI | US-010 → US-012 | Full scrape setup flow: create project, draw area, launch scrape |
| 4. Explorer | US-013 → US-016 | Map + table + detail panel with linked selection |
| 5. Search & Filters | US-017 → US-019 | Fuzzy search, filter panel, review keyword search |
| 6. Shortlists | US-020 → US-021 | Star places, named shortlists, comparison, CSV export |
| 7. Polish | US-022 → US-024 | Re-scrape, external links, stale data indicators |

## Story details

See `prd.json` for the machine-readable story list with acceptance criteria. Below is a human-readable summary of each story with implementation guidance.

---

### Phase 1: Foundation

**US-001: Project restructure — monorepo setup**
Move the existing MVP scraper to `legacy/`. Create `server/` and `client/` packages with their own `package.json` and `tsconfig.json`. Add a root-level npm workspaces config. The server uses Express + TypeScript. The client uses Vite + React + TypeScript. Both should build and typecheck cleanly. Add a `.env.example` with `GOOGLE_MAPS_API_KEY` placeholder.

**US-002: SQLite database schema and data access layer**
Create the SQLite schema in `server/src/db/` covering all entities from SPEC.md §6: Project, ScrapeRun, Tile, Place, Review, PlaceScrapeRun, Shortlist, ShortlistEntry. Use `better-sqlite3` (synchronous, simple). Provide typed query functions for CRUD operations on each entity. Write tests that verify schema creation and basic CRUD.

**US-003: Express API skeleton**
Create the Express server in `server/src/index.ts` with route modules for projects, scrapes, places, and shortlists. Implement CRUD endpoints for Projects (the simplest entity) end-to-end as a proof that the API → DB pipeline works. Other route files can export placeholder routers. Server should start, respond to health check, and project CRUD should work via curl/test.

**US-004: React app shell with Google Maps**
Bootstrap the React app using Vite. Set up React Router with placeholder pages: Setup, Explorer, Shortlists. Embed a Google Maps view on the Setup page using `@vis.gl/react-google-maps` (the official Google Maps React library). The map should render, be pannable/zoomable, and load the API key from an environment variable. Proxy API requests to the Express server via Vite dev server config.

---

### Phase 2: Scraper Core

**US-005: Extract scraper into modular engine**
Refactor the existing MVP scraper logic (`legacy/src/index.ts`) into `server/src/scraper/engine.ts`. The engine should be importable (not a standalone script) and accept configuration via function parameters. It should write results to SQLite (not JSON/CSV). Preserve the core scraping logic: URL collection via scrolling, detail page extraction, CAPTCHA pause, checkpoint/resume. Add tests for the non-browser-dependent parts (URL normalization, lat/lng parsing, CSV escape).

**US-006: Adaptive tiling algorithm**
Implement `server/src/scraper/tiling.ts`. Given a bounding box, generate an initial coarse grid (~0.1°). The scraper processes one tile at a time: searches Google Maps at the tile center, scrolls results to exhaustion, counts results. If result count ≥ threshold (~120), subdivide into 4 sub-tiles and queue them. Track tile status (pending/running/completed/subdivided) in the Tile table. Enforce a minimum tile size floor. Write unit tests for the tiling math (subdivision, bounds calculation, progress tracking).

**US-007: Enhanced detail extraction**
Extend `server/src/scraper/extractor.ts` to extract additional fields beyond the MVP: priceLevel, photoUrls (first N image URLs from the carousel), openingHours (text), and amenities (best-effort from the About/amenities tab). Store reviews in the Review table (text + rating per review). Write tests for the extraction parsing logic where possible (mock HTML snippets).

**US-008: Website classification**
Implement `server/src/scraper/classifier.ts`. Given a URL, classify the domain as `direct`, `ota`, `social`, or `unknown` using a hardcoded allowlist of ~30 OTA/social domains. Write comprehensive tests covering known OTA domains (booking.com, airbnb.com, expedia.com, etc.), social media, direct hotel sites, and edge cases (subdomains, URL variations).

**US-009: Scrape API — start, monitor, pause**
Wire the scraper engine into the Express API. Implement endpoints: POST to start a scrape run (project ID + query), GET scrape run status/progress, POST to pause/resume. The scraper runs in the background (spawned as an async task in the server process). Implement Server-Sent Events (SSE) endpoint for live progress updates (tiles completed, places found, estimated time). Write an integration test that starts a mock scrape and verifies progress events.

---

### Phase 3: Scrape Setup UI

**US-010: Project management UI**
Create a Projects page in the React app. List existing projects with name, creation date, place count. "New Project" button opens a form (name input). Projects are created via the API. Clicking a project navigates to its Setup page. Basic but functional — no need for fancy styling yet.

**US-011: Google Maps area selection**
On the project Setup page, add a Google Maps view with a "Select Area" button. When clicked, the current map viewport becomes a draggable/resizable rectangle overlay (using Google Maps Drawing/Rectangle API). The user can adjust the rectangle. The bounding box coordinates (SW/NE lat/lng) are displayed below the map and stored when the user confirms. If the project already has bounds, show the existing rectangle on load.

**US-012: Scrape launch and live progress**
Add a query input field and "Start Scrape" button to the Setup page. When clicked, call the API to start a scrape run. Show a progress panel: subscribe to the SSE endpoint and display live stats (tiles completed/total, places found, elapsed time, estimated remaining). Overlay tile status on the Google Maps view using colored rectangles (green=complete, yellow=running, gray=pending). The user should be able to navigate away and return to see current progress.

---

### Phase 4: Explorer

**US-013: Map view with place markers**
Create the Explorer page. Fetch all places for the current project from the API. Render them as custom markers on a Google Maps view. Color markers by rating (red < 3.5, yellow 3.5–4.2, green > 4.2). Implement marker clustering for zoomed-out views using `@googlemaps/markerclusterer`. Clicking a marker should (for now) log the place to console — selection sync comes in US-016.

**US-014: Place table with sorting and virtual scrolling**
Add a table below the map on the Explorer page. Display all places with columns: Name, Category, Rating, Review Count, Price Level, Website (linked), Address. Make columns sortable. Implement virtual scrolling to handle 5,000+ rows without lag (use TanStack Table with a virtualizer, or react-window). Add an inline text filter input above the table.

**US-015: Detail panel**
Add a right-side panel on the Explorer page that shows full details of a selected place. Display: name, category, rating (stars), review count, price level, address, phone (tel: link), website (with Direct/OTA/Social badge), amenities list, photo URLs as a thumbnail strip, opening hours, scrapedAt timestamp. Below that, show all reviews (rating + text) with a search input to filter reviews within the panel. Include action links: "Open in Google Maps" (using googleUrl).

**US-016: Map ↔ Table selection sync**
Wire up bidirectional selection: clicking a marker on the map highlights the corresponding row in the table and opens the detail panel; clicking a row in the table centers the map on that marker and opens the detail panel. The selected marker should have a distinct visual style (e.g., larger, different color, or bouncing).

---

### Phase 5: Search & Filters

**US-017: Fuzzy text search**
Add a search bar at the top of the Explorer page. Implement fuzzy text search across place name, address, category, amenities, and review text. Search results update both the map (only matching markers visible) and the table. Use a client-side fuzzy search library (e.g., Fuse.js) or implement server-side search with SQLite FTS5. Debounce input (300ms).

**US-018: Filter panel**
Add a collapsible filter panel to the Explorer page. Implement filters: rating range (slider), minimum review count (input), category (multi-select checkboxes, populated from data), has website (toggle), website type (direct/OTA checkboxes), price level (multi-select). All filters combine with AND logic. Filters update map markers and table simultaneously. Filters should persist in URL query parameters so they survive page refresh.

**US-019: Review keyword search and distance filter**
Add two advanced filters: (1) Review keyword — a text input that filters to places where at least one review contains the keyword, with the keyword highlighted in the detail panel's review section. (2) Distance from point — user clicks a point on the map, a radius slider appears (1–50km), and only places within that radius are shown. Both integrate with the existing filter system.

---

### Phase 6: Shortlists

**US-020: Star/bookmark places and shortlist management**
Add a ⭐ toggle button in the table rows, map marker popups, and detail panel. Starred places are saved to a default shortlist via the API. Add a Shortlists page accessible from the nav. Allow creating named shortlists. Allow moving starred places between shortlists. Each shortlist entry can have user-added notes (free text). Implement the full shortlist CRUD API endpoints.

**US-021: Comparison view and CSV export**
On the Shortlists page, allow selecting 2–3 places for side-by-side comparison. Show a comparison table with key fields in columns (name, rating, reviews, price, website, amenities). Add a "Export CSV" button that downloads the shortlist as a CSV file. Include all place fields plus user notes.

---

### Phase 7: Polish

**US-022: Re-scrape support**
Add a "Refresh Data" button on the project page. When clicked, the server re-visits the detail pages of all existing places in the project to update their data (rating, reviews, price, website, amenities). Reuse the existing scraper engine but skip the tiling/discovery phase — iterate over known place URLs. Track re-scrape as a special ScrapeRun type. Show progress in the UI.

**US-023: External search links**
In the detail panel, add auto-generated "Search on Booking.com" and "Search on Airbnb" links. Construct URLs by encoding the place name + location into the OTA's search URL format. These open in a new tab.

**US-024: Stale data indicators**
In the table and detail panel, show a subtle visual indicator (icon + tooltip) for places where `scrapedAt` is older than 7 days. The threshold should be configurable. In the filter panel, add a "Show stale only" toggle to quickly find places that need re-scraping.
