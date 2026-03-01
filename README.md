# GoMaps — Google Maps Accommodation Scraper

A personal accommodation discovery tool that scrapes Google Maps across a user-defined area, collects rich place data (details, reviews, amenities, pricing), and presents results in an interactive Google Maps-based Explorer UI for filtering, comparison, and direct-booking discovery.

**Primary use case:** Find accommodation beyond what Booking.com and Airbnb surface — and for places that do appear on OTAs, find the property's own website to book directly at a lower price.

## Getting Started

### Prerequisites

- Node.js 18+
- A [Google Maps API key](https://developers.google.com/maps/documentation/javascript/get-api-key) (free tier $200/month credit is sufficient)

### Setup

```bash
# Install dependencies
npm install

# Install Playwright browser (needed for scraping)
npx playwright install chromium

# Create .env from the example
cp .env.example .env
# Edit .env and add your Google Maps API key
```

The `.env` file should define separate server and browser keys:

```
GOOGLE_PLACES_API_KEY=your_server_key_here
VITE_GOOGLE_MAPS_API_KEY=your_browser_key_here
```

Notes:
- `GOOGLE_PLACES_API_KEY` is used by the server for Places API HTTP calls and should not be HTTP-referrer restricted (IP restrictions are OK).
- `VITE_GOOGLE_MAPS_API_KEY` is used in the browser for Maps JavaScript and can be HTTP-referrer restricted to localhost.
- `GOOGLE_MAPS_API_KEY` is still supported by the server as a fallback when `GOOGLE_PLACES_API_KEY` is unset.

### Running locally

```bash
# Terminal 1 — Express API server (http://localhost:3180)
npm run dev --workspace=server

# Terminal 2 — React dev server (http://localhost:5173)
npm run dev --workspace=client
```

The Vite dev server proxies `/api/*` requests to the Express server automatically.

### Build & verify

```bash
# Typecheck both packages
npm run typecheck --workspace=server
npm run typecheck --workspace=client

# Run server tests
npm test --workspace=server

# Run client E2E tests (headless)
npm run test:e2e --workspace=client

# Run client E2E tests headed with slow motion
PW_SLOW_MO=25 npm run test:e2e --workspace=client -- --headed

# Run client E2E with separate Playwright LCOV output (non-gating job target)
npm run test:e2e:coverage --workspace=client

# Production build
npm run build --workspace=server
npm run build --workspace=client
```

## Project Structure

```
gomaps/
├── server/          # Express + TypeScript + better-sqlite3 + Playwright
│   ├── src/
│   │   ├── db/          # SQLite schema and data access layer
│   │   ├── routes/      # Express route modules
│   │   └── scraper/     # Scraper engine and utilities
│   └── tests/
├── client/          # Vite + React + TypeScript + @vis.gl/react-google-maps
│   └── src/
│       ├── pages/       # React Router pages
│       └── lib/         # API client
└── data/            # SQLite database (created at runtime)
```

## Current Status

The project is being built incrementally. See [`DEVELOPMENT.md`](DEVELOPMENT.md) for the phased plan and [`prd.json`](prd.json) for story-level progress.

**Completed:**
- Monorepo with npm workspaces (server + client)
- SQLite database schema with full data model
- Express API with project CRUD
- React app shell with Google Maps, routing (Setup/Explorer/Shortlists)
- Modular scraper engine (Playwright-based, writes to SQLite)

**Upcoming:**
- Adaptive tiling algorithm
- Scrape API with SSE progress
- Interactive Explorer UI (map + table + detail panel + filters)
- Direct booking detection (website classification)
- Shortlists with comparison and CSV export

## Architecture

See [`SPEC.md`](SPEC.md) for the full product specification.

**Key features:**
- **Adaptive tiling** — automatically subdivides search areas to overcome Google Maps' ~120 result cap
- **Interactive Explorer UI** — Google Maps-based view with markers, table, detail panel, and filters
- **Direct booking detection** — classifies place websites as direct, OTA, or social
- **Shortlists** — star places, compare side-by-side, export CSV
- **Re-scraping** — refresh stale data for existing places

## Notes

- Google Maps selectors can change — extraction is best-effort and may require selector updates
- No Google login required — the scraper operates as an anonymous browser session
- All data is stored locally in SQLite — no external services beyond Google Maps
