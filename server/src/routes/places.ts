import { Router } from 'express'
import { Effect } from 'effect'
import { listPlaces, listReviews } from '../db/index.js'
import { appRuntime } from '../runtime.js'

export const placesRouter = Router()

placesRouter.get('/:placeId/reviews', async (req, res) => {
  const placeId = req.params.placeId

  await appRuntime.runPromise(
    listReviews(placeId).pipe(
      Effect.andThen((reviews) => Effect.sync(() => res.json(reviews))),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      ),
    )
  )
})

placesRouter.get('/', async (req, res) => {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined

  await appRuntime.runPromise(
    listPlaces(projectId).pipe(
      Effect.andThen((places) => Effect.sync(() => res.json(places))),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      ),
    )
  )
})
