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

- **Server:** Express + TypeScript + better-sqlite3 + Playwright
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

## File organization

- Server routes in `server/src/routes/` — one file per resource
- Database access functions in `server/src/db/` — no raw SQL in route handlers
- Scraper modules in `server/src/scraper/`
- React components in `client/src/components/`
- API client functions in `client/src/lib/api.ts`
- React hooks in `client/src/hooks/`

## Important notes

- The Google Maps API key is provided by the user in `.env` as `GOOGLE_MAPS_API_KEY` (server) and `VITE_GOOGLE_MAPS_API_KEY` (client)
- The Playwright scraper does NOT use any Google API — it drives a real browser
- The Google Maps JavaScript API (embedded maps in the React UI) is a separate concern from scraping
- The legacy MVP code is preserved in `legacy/` for reference — do not modify it
- SQLite database file goes in `data/gomaps.db` — ensure `data/` is in `.gitignore`
- Never commit `.env` files or API keys
