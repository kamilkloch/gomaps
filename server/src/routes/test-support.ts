import { Router } from 'express'
import { Effect, Schema } from 'effect'
import {
  createPlace,
  createProject,
  createScrapeRun,
  createTile,
  getProject,
  linkPlaceToScrapeRun,
  truncateAllTables,
  updateScrapeRun,
  updateTile,
} from '../db/index.js'
import { ValidationError } from '../errors.js'
import { appRuntime } from '../runtime.js'
import { resetScrapeRouteStateForTests } from './scrape.js'

export const testSupportRouter = Router()

const RunStatusSchema = Schema.Literal('pending', 'running', 'paused', 'completed', 'failed')
const TileStatusSchema = Schema.Literal('pending', 'running', 'completed', 'subdivided')
const WebsiteTypeSchema = Schema.Literal('direct', 'ota', 'social', 'unknown')

const SeedRequestSchema = Schema.Struct({
  existingProjectId: Schema.optional(Schema.String),
  project: Schema.Struct({
    name: Schema.String,
    bounds: Schema.String,
  }),
  scrapeRun: Schema.optional(
    Schema.Struct({
      query: Schema.optional(Schema.String),
      status: Schema.optional(RunStatusSchema),
      tilesTotal: Schema.optional(Schema.Number),
      tilesCompleted: Schema.optional(Schema.Number),
      tilesSubdivided: Schema.optional(Schema.Number),
      placesFound: Schema.optional(Schema.Number),
      placesUnique: Schema.optional(Schema.Number),
    })
  ),
  tiles: Schema.optional(
    Schema.Array(
      Schema.Struct({
        bounds: Schema.String,
        zoomLevel: Schema.Number,
        status: Schema.optional(TileStatusSchema),
        resultCount: Schema.optional(Schema.Number),
      })
    )
  ),
  places: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        googleMapsUri: Schema.String,
        googleMapsPhotosUri: Schema.optional(Schema.String),
        name: Schema.String,
        lat: Schema.Number,
        lng: Schema.Number,
        category: Schema.optional(Schema.String),
        rating: Schema.optional(Schema.Number),
        reviewCount: Schema.optional(Schema.Number),
        priceLevel: Schema.optional(Schema.String),
        phone: Schema.optional(Schema.String),
        website: Schema.optional(Schema.String),
        websiteType: Schema.optional(WebsiteTypeSchema),
        address: Schema.optional(Schema.String),
        photoUrls: Schema.optional(Schema.Array(Schema.String)),
        openingHours: Schema.optional(Schema.String),
        amenities: Schema.optional(Schema.Array(Schema.String)),
      })
    )
  ),
})

testSupportRouter.post('/reset-db', async (_req, res) => {
  await appRuntime.runPromise(
    truncateAllTables().pipe(
      Effect.andThen(
        Effect.sync(() => {
          resetScrapeRouteStateForTests()
          res.status(204).end()
        })
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      )
    )
  )
})

testSupportRouter.post('/seed-fixtures', async (req, res) => {
  await appRuntime.runPromise(
    Effect.gen(function* () {
      const body = yield* Schema.decodeUnknown(SeedRequestSchema)(req.body).pipe(
        Effect.mapError(
          () => new ValidationError({ message: 'Invalid fixture payload for /api/test/seed-fixtures' })
        )
      )

      const places = body.places ?? []
      const tiles = body.tiles ?? []
      const shouldCreateRun = Boolean(body.scrapeRun) || places.length > 0 || tiles.length > 0

      const project = body.existingProjectId
        ? yield* getProject(body.existingProjectId)
        : yield* createProject(body.project.name, body.project.bounds)

      let scrapeRunId: string | null = null
      if (shouldCreateRun) {
        const scrapeRun = yield* createScrapeRun(
          project.id,
          body.scrapeRun?.query ?? 'seeded-run'
        )
        scrapeRunId = scrapeRun.id

        const now = new Date().toISOString()
        const status = body.scrapeRun?.status ?? 'completed'
        yield* updateScrapeRun(scrapeRun.id, {
          status,
          tilesTotal: body.scrapeRun?.tilesTotal ?? tiles.length,
          tilesCompleted:
            body.scrapeRun?.tilesCompleted
            ?? tiles.filter((tile) => tile.status === 'completed').length,
          tilesSubdivided:
            body.scrapeRun?.tilesSubdivided
            ?? tiles.filter((tile) => tile.status === 'subdivided').length,
          placesFound: body.scrapeRun?.placesFound ?? places.length,
          placesUnique: body.scrapeRun?.placesUnique ?? places.length,
          startedAt: now,
          completedAt: status === 'completed' ? now : null,
        })

        for (const tile of tiles) {
          const createdTile = yield* createTile(scrapeRun.id, tile.bounds, tile.zoomLevel)
          yield* updateTile(createdTile.id, {
            status: tile.status ?? 'pending',
            resultCount: tile.resultCount ?? 0,
          })
        }

        for (const place of places) {
          yield* createPlace({
            ...place,
            photoUrls: place.photoUrls ? [...place.photoUrls] : undefined,
            amenities: place.amenities ? [...place.amenities] : undefined,
          })
          yield* linkPlaceToScrapeRun(place.id, scrapeRun.id)
        }
      }

      res.status(201).json({
        projectId: project.id,
        scrapeRunId,
        placeIds: places.map((place) => place.id),
      })
    }).pipe(
      Effect.catchTag('ValidationError', (error) =>
        Effect.sync(() => res.status(400).json({ error: error.message }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      )
    )
  )
})
