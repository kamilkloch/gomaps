# GoMaps — Google Maps Accommodation Scraper

A personal accommodation discovery tool that scrapes Google Maps across a user-defined area, collects rich place data (details, reviews, amenities, pricing), and will present results in an interactive Google Maps-based Explorer UI for filtering, comparison, and direct-booking discovery.

**Primary use case:** Find accommodation beyond what Booking.com and Airbnb surface — and for places that do appear on OTAs, find the property's own website to book directly at a lower price.

## Current Status

The project is currently an **MVP CLI scraper** (`src/index.ts`). The full product vision — a monorepo with Express backend, React frontend, SQLite storage, and interactive Explorer UI — is defined in [`SPEC.md`](SPEC.md) and tracked in [`DEVELOPMENT.md`](DEVELOPMENT.md).

## MVP Scraper

### What it does

- Opens Google Maps search for a query (e.g., `hotels in Sardinia`)
- Scrolls the left result panel and collects place URLs
- Visits each place page and extracts:
  - name, category, rating, review count
  - phone, website, address
  - lat/lng (parsed from URL)
  - top review snippets (best effort)
- Writes `JSON` and `CSV` output
- Saves checkpoints so runs can resume

### Setup

```bash
npm install
npx playwright install chromium
```

### Usage

```bash
npm run dev -- --query "hotels in Sardinia" --max-places 150 --out-dir data/sardinia
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--query` | `hotels in Sardinia` | Search query |
| `--max-places` | `250` | Max place pages to scrape |
| `--scroll-steps` | `60` | Max scroll cycles in result feed |
| `--out-dir` | `data` | Output directory |
| `--headless` | `false` | Run browser headless |
| `--delay-ms` | `1200` | Delay between detail page scrapes |
| `--review-limit` | `3` | Max review snippets per place |
| `--resume` | `false` | Continue from existing checkpoint |

**Resume a previous run:**

```bash
npm run dev -- --query "hotels in Sardinia" --out-dir data/sardinia --resume true
```

### Output files

| File | Description |
|------|-------------|
| `checkpoint.json` | Incremental run state |
| `results.json` | Final structured output |
| `results.csv` | Spreadsheet-friendly output |
| `profile/` | Persistent Chromium profile |

### Manual intervention

If a challenge page is detected (CAPTCHA, "verify you are human", unusual traffic), the script pauses and asks you to solve it in the browser, then press Enter in the terminal to continue.

## Planned Architecture

See [`SPEC.md`](SPEC.md) for the full product specification and [`DEVELOPMENT.md`](DEVELOPMENT.md) for the phased implementation plan.

```
gomaps/
├── server/          # Express + TypeScript + better-sqlite3 + Playwright
├── client/          # Vite + React + TypeScript + @vis.gl/react-google-maps
└── legacy/          # Original MVP scraper (preserved for reference)
```

**Key planned features:**

- **Adaptive tiling** — automatically subdivides search areas to overcome Google Maps' ~120 result cap
- **Interactive Explorer UI** — Google Maps-based view with markers, table, detail panel, and filters
- **Direct booking detection** — classifies place websites as direct, OTA, or social
- **Shortlists** — star places, compare side-by-side, export CSV
- **Re-scraping** — refresh stale data for existing places

## Notes

- Google Maps selectors can change — extraction is best-effort and may require selector updates
- No Google login required — the scraper operates as an anonymous browser session
- A Google Maps API key is required for the planned Explorer UI (free tier $200/month credit is sufficient)
