# GoMaps — Agent Instructions

## Project overview

Google Maps accommodation scraper with interactive Explorer UI. See `SPEC.md` for product specification, `DEVELOPMENT.md` for implementation guide, `prd.json` for story tracking.

## Build & test commands

```bash
# Install dependencies (from root)
npm install

# Typecheck (both packages)
npm run typecheck --workspace=server
npm run typecheck --workspace=client

# Run server tests
npm test --workspace=server

# Build
npm run build --workspace=server
npm run build --workspace=client

# Start server (dev)
npm run dev --workspace=server

# Start client (dev)
npm run dev --workspace=client
```

## Tech stack

- **Server:** Express + TypeScript + better-sqlite3 + Effect + Google Places API (New)
- **Client:** Vite + React + TypeScript + @vis.gl/react-google-maps
- **Monorepo:** npm workspaces (server/ and client/)
- **Database:** SQLite (file-based, stored in data/gomaps.db)

## Code conventions

- TypeScript strict mode in both packages
- Use `type` imports where possible (`import type { ... }`)
- Named exports (no default exports)
- Error handling: let errors propagate in internal code; handle at API boundaries
- Use async/await (no raw promises or callbacks)
- No classes unless necessary — prefer functions and plain objects

## Effect best practices (server only, v3.19.19)

- **Sync I/O that may throw** (e.g., better-sqlite3): use `Effect.try({ try: () => ..., catch: (e) => new MyError(...) })` — NOT `Effect.tryBlocking` (does not exist) or `Effect.sync` (swallows errors as defects)
- **Services**: define with `Context.Tag`, access via `yield* MyService` in gen blocks or `Effect.flatMap(MyService, ...)`
- **Resource lifecycle**: `Layer.scoped` + `Effect.acquireRelease` (see `Db.ts` for the DB connection pattern)
- **Running effects**: use `ManagedRuntime.make(layer)` → `appRuntime.runPromise()` / `appRuntime.runSync()` — never bare `Effect.runPromise` when the effect requires services
- **Typed errors**: extend `Data.TaggedError('Tag')<{ ... }>`, catch with `Effect.catchTag('Tag', ...)`
- **Schema**: import from `effect` (`import { Schema } from 'effect'`), not `@effect/schema`
- **Schema decode mutability**: values decoded from Effect `Schema` can be inferred as readonly arrays; clone array fields (`[...value]`) when passing to mutable DB input types like `CreatePlaceInput`
- **Do not invent Effect APIs** — if you're unsure whether a function exists, check the installed types in `node_modules/effect/dist/dts/`

## File organization

- Server routes in `server/src/routes/` — one file per resource
- Database access functions in `server/src/db/` — no raw SQL in route handlers
- Scraper modules in `server/src/scraper/`
- Tiling logic should live in `server/src/scraper/tiling.ts` as pure bounds math (`generateTiles`, `subdivideTile`, `shouldSubdivide`) plus thin DB progress helpers
- Scrape orchestration should live in `server/src/scraper/engine.ts`; when creating/subdividing tiles, use tiling helpers (`initializeTilesForRun`, `subdivideTileInRun`, `markTileCompleted`) so scrape-run counters stay consistent
- Scrape API route orchestration (`server/src/routes/scrape.ts`) should keep ephemeral run state (pause flags/background task handles/SSE subscribers) module-scoped and expose small test hooks when async behavior needs deterministic integration tests
- React components in `client/src/components/`
- API client functions in `client/src/lib/api.ts`
- React hooks in `client/src/hooks/`

## Important notes

- The Google Maps API key is provided by the user in `.env` as `GOOGLE_MAPS_API_KEY` (server) and `VITE_GOOGLE_MAPS_API_KEY` (client)
- For advanced map overlays in React (`Rectangle`, listeners, imperative map APIs), keep imperative Google Maps objects in small child components that use `useMap()` (for map access) and forward state changes to parent callbacks
- In client files importing the `Map` component from `@vis.gl/react-google-maps`, use `globalThis.Map` for JS map collections to avoid TypeScript symbol collisions
- For Explorer marker rendering, keep marker/cluster lifecycles in a dedicated `useMap()` child controller (manage `google.maps.Marker` + `MarkerClusterer` refs there, and update via props/state) instead of creating map objects directly in page components
- For Explorer map↔table sync with virtualized rows, keep a single selected-place id source of truth and scroll the table viewport to the selected row index when marker selection lands on an off-screen row
- For Explorer global search, keep the input debounced (~300ms) and run Fuse-based fuzzy matching across name/address/category/amenities plus cached review text; lazily preload per-place reviews only while a search query is active to avoid large background request bursts
- For Explorer filter panels, keep map/table-shared filters (rating/category/website) as AND-composed state persisted in URL query params (`useSearchParams`) and layer table quick-filter text as a table-only refinement
- For Explorer advanced filters, keep review-keyword matching tied to cached per-place reviews and render distance filtering via map-click center selection plus a radius circle/marker overlay managed inside the `useMap()` marker controller
- Scraping/discovery now uses Google Places API (New) over server-side HTTP (`places:searchText`, `places/{placeId}`)
- Keep Places field masks explicit with `X-Goog-FieldMask` headers to control SKU/cost and avoid over-fetching
- Classify place websites by normalized hostname (supporting protocol-less URLs and subdomains) in `server/src/scraper/classifier.ts`, and persist `websiteType` from that classifier instead of hardcoded defaults
- Project cards should consume backend-derived aggregate fields (`status`, `placesCount`, `scrapeRunsCount`, `lastScrapedAt`, `activeRunId`) from `/api/projects`; do not infer cross-run status in the client from bounds or ad-hoc heuristics
- When ordering SQLite rows by timestamp fields like `created_at`, add a deterministic tie-breaker (`rowid DESC` or equivalent) so rapid same-second inserts keep stable UI ordering
- In Setup, treat run selection as run-scoped state: when `activeRunId` changes, clear prior progress/tile snapshots before loading the new run so stale counters cannot leak across run switches
- For deep links like `/projects/:projectId/setup`, map API `404` responses to a deterministic "Project not found." UI state instead of showing generic transient load errors
- For Projects, Setup, and Explorer accessibility/E2E stability, expose named regions (`role="region"` + `aria-label`) for key panels and keep table row selection keyboard-accessible via `tabIndex` + Enter/Space handlers
- The Google Maps JavaScript API (embedded maps in the React UI) is a separate concern from scraping
- The legacy MVP code is preserved in `legacy/` for reference — do not modify it
- SQLite database file goes in `data/gomaps.db` — ensure `data/` is in `.gitignore`
- Never commit `.env` files or API keys

## LLM Agent Testing Guide (Visual Browser Tests)

When verifying features via browser testing, you must systematically test every interactive element. Do not assume background processes (like API calls) succeed without visual confirmation in the UI. Follow this checklist for rigorous visual testing:

### 1. Project Management
- **Create Project:** Navigate to `/` (Projects page), click "New Project", enter a name, and submit. Verify the new project appears in the list.
- **Open Project:** Click on a project in the list. Verify the app navigates to the Setup page for that project.

### 2. Scrape Setup & Execution
- **Map Interaction:** Ensure the Google Maps container renders. Try clicking and dragging to pan.
- **Area Selection:** Click "Select Area". Verify the drawing tools activate and a rectangular bounding box overlay appears. Drag the handles of the rectangle to resize it.
- **Scrape Launch:** Type a query (e.g., "hotel") in the search input. Click "Start Scrape".
- **Live Progress:** Verify the progress panel appears. Visually confirm that stats update (tiles completed, places found). Check the map overlay for color changes (tiles turning from gray to yellow to green).
- **Control:** Test pausing and resuming the scrape run if those controls are available in the UI.

### 3. Explorer UI (Map & Table)
- **Navigation:** Navigate to the Explorer view.
- **Map View:** Verify place markers render. Zoom and pan the map to ensure clustering works.
- **Table View:** Scroll the table to test virtual scrolling. Click column headers to test sorting (verify order changes). Check the inline quick-filter updates results.
- **Selection Sync:** 
  - Click a row in the table: verify the map centers on the corresponding marker and the Detail Panel opens.
  - Click a marker on the map: verify the table scrolls to and highlights the corresponding row, and the Detail Panel opens.

### 4. Search & Filters
- **Fuzzy Search:** Type a keyword in the search bar. Verify both the table rows and map markers filter after the debounce window (~300ms) to match the query.
- **Filter Panel:** 
  - **Sliders:** Adjust the Rating or Price sliders; verify results update.
  - **Checkboxes:** Toggle Category and Website Type checkboxes. Ensure combinations use AND logic.
  - **Review Keyword Search:** Enter a specific string. Verify the Detail Panel highlights the keyword in the reviews section.
  - **Distance Filter:** Click the map point selector and adjust the radius slider. Verify filtering works based on the selected point.

### 5. Detail Panel & Actions
- **Content:** With a place selected, verify the panel displays name, rating, address, amenities, opening hours, and photos.
- **Website Badges:** Check the visual color coding of the website link (Green = Book Direct, Orange = OTA, Gray = No website).
- **Links & Exports:** Click "Open in Google Maps", "Search on Booking.com", and "Search on Airbnb" to ensure they construct correct URLs and open in a new tab.
- **Re-scrape / Stale Data:** Look for "stale" indicators on places scraped >7 days ago. Test the "Refresh Data" (re-scrape) button and observe the progress indicator.

### 6. Shortlists
- **Starring:** Click the ⭐ icon on a place (in table, map popup, or detail panel). Verify it is saved to a shortlist.
- **Shortlist View:** Navigate to the Shortlists page. Verify the starred place appears.
- **Comparison:** Select 2-3 places and verify the side-by-side comparison table renders correctly.
- **Notes:** Add free-text notes to a shortlisted place and confirm they save.
- **Export:** Click the "Export CSV" button and verify a download is triggered containing all place fields plus notes.

**General Rule:** Always verify that URL routes update appropriately during navigation, and check the browser console for any silent errors when interacting with complex components like the map or virtualized table.

## Tooling & Execution Mechanics (Playwright)

You will execute all interactions using the Playwright framework. You must adhere strictly to the following Playwright best practices for React applications to prevent flaky tests:

### 1. Locator Strategy (Strict Hierarchy)

Do NOT use XPath or fragile CSS selectors (e.g., `div > span:nth-child(2)`). You must select elements using the following priority:
* **Priority 1:** `page.getByTestId('...')` (Use this whenever `data-testid` attributes are present in the DOM).
* **Priority 2:** `page.getByRole('button', { name: 'Submit' })` (Use accessible roles).
* **Priority 3:** `page.getByText('Specific text')`.
* *Rule:* If an element cannot be found using these three methods, log it as an "Accessibility / Testability Defect" before proceeding.


### 2. Handling React Asynchrony (Waiting)

React batches state updates. You must never assume an action resolves instantly.
* **Never use hardcoded sleeps** (e.g., `page.waitForTimeout(5000)`).
* **Wait for state:** After clicking or typing, wait for the specific visual change to appear in the DOM using `await expect(locator).toBeVisible()` or wait for the network to settle using `await page.waitForLoadState('networkidle')`.
* **Pending-request states:** To verify temporary loading copy (e.g., "Saving bounds…"), hold the matching `page.route()` response behind a deferred promise, assert the loading UI, then resolve the request.


### 3. Visual Verification Mechanisms

Since this is a visual browser test, you must actively capture the visual state:
* **Screenshots:** Take a full-page screenshot before and after complex interactions or when entering a new view using `await page.screenshot({ path: 'step-[n].png', fullPage: true })`. Use these screenshots to verify layout integrity.
* **Console Errors:** Actively monitor the page console. Fail the interaction immediately if Playwright captures a React `ErrorBoundary` trigger or a severe console error (`page.on('pageerror', exception => ...)`).


### 4. Interaction Isolation

Always execute interactions from a clean state. Ensure you are resetting the browser context or clearing cookies/local storage between distinct logical test flows to prevent React state bleed over.

### 5. E2E Test Harness Pattern

- Keep Playwright helpers under `client/e2e/` with shared fixtures/utilities/page objects (`fixtures/`, `utils/`, `pages/`, `tests/`) so future stories reuse the same stability primitives.
- For deterministic UI-flow coverage, prefer a single stateful `page.route('**/api/**', ...)` mock per test and mutate in-memory fixtures instead of relying on live backend/external API behavior.
- For backend-integration e2e coverage, run server in `E2E_TEST_MODE=1` and reset SQLite state before each test via `POST /api/test/reset-db`; this endpoint must stay disabled outside test mode.
- In `client/playwright.config.ts`, load root `.env` values before defining web servers so `VITE_GOOGLE_MAPS_API_KEY`/`GOOGLE_MAPS_API_KEY` are available consistently in local and CI-style runs.
- Avoid `waitForLoadState('networkidle')` on pages that keep long-lived requests open (e.g., SSE progress streams in Setup); prefer waiting on stable UI locators/state changes.
- Setup page map diagnostics can be forced in Playwright-only mode (`VITE_E2E_TEST_MODE=1`) via `?e2eMapDiagnostic=api-key-error|init-timeout|tiles-timeout`; tile-overlay style/status assertions can read the hidden `setup-tile-overlay-debug` JSON snapshot.
- For Explorer map marker assertions in Playwright, prefer the hidden `explorer-marker-debug` JSON snapshot (enabled only in `VITE_E2E_TEST_MODE=1`) instead of brittle Google Maps internal DOM hooks.
- For Explorer map interaction + clustering assertions in Playwright, use the E2E-only hooks exposed in test mode: `explorer-cluster-debug`, `explorer-selection-circle-debug`, and `window.__gomapsExplorerDebug` (marker-click/map-click/zoom actions).
