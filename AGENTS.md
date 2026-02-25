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
- **Do not invent Effect APIs** — if you're unsure whether a function exists, check the installed types in `node_modules/effect/dist/dts/`

## File organization

- Server routes in `server/src/routes/` — one file per resource
- Database access functions in `server/src/db/` — no raw SQL in route handlers
- Scraper modules in `server/src/scraper/`
- React components in `client/src/components/`
- API client functions in `client/src/lib/api.ts`
- React hooks in `client/src/hooks/`

## Important notes

- The Google Maps API key is provided by the user in `.env` as `GOOGLE_MAPS_API_KEY` (server) and `VITE_GOOGLE_MAPS_API_KEY` (client)
- Scraping/discovery now uses Google Places API (New) over server-side HTTP (`places:searchText`, `places/{placeId}`)
- Keep Places field masks explicit with `X-Goog-FieldMask` headers to control SKU/cost and avoid over-fetching
- The Google Maps JavaScript API (embedded maps in the React UI) is a separate concern from scraping
- The legacy MVP code is preserved in `legacy/` for reference — do not modify it
- SQLite database file goes in `data/gomaps.db` — ensure `data/` is in `.gitignore`
- Never commit `.env` files or API keys
