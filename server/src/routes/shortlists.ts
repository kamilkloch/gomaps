import { Router } from 'express'
import { Effect, Schema } from 'effect'
import {
  addShortlistEntry,
  createShortlist,
  deleteShortlist,
  getShortlist,
  getShortlistEntry,
  listShortlistEntries,
  listShortlists,
  removeShortlistEntry,
  updateShortlist,
  updateShortlistEntryNotes,
} from '../db/index.js'
import { ValidationError } from '../errors.js'
import { appRuntime } from '../runtime.js'

export const shortlistsRouter = Router()

const CreateShortlistBody = Schema.Struct({
  projectId: Schema.String,
  name: Schema.String,
})

const UpdateShortlistBody = Schema.Struct({
  name: Schema.String,
})

const AddShortlistEntryBody = Schema.Struct({
  placeId: Schema.String,
  notes: Schema.optional(Schema.String),
})

const UpdateShortlistEntryBody = Schema.Struct({
  notes: Schema.String,
})

shortlistsRouter.get('/', async (req, res) => {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined

  await appRuntime.runPromise(
    Effect.gen(function* () {
      if (!projectId) {
        return yield* Effect.sync(() => res.status(400).json({ error: 'projectId query param is required' }))
      }

      const shortlists = yield* listShortlists(projectId)
      yield* Effect.sync(() => res.json(shortlists))
    }).pipe(
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      ),
    )
  )
})

shortlistsRouter.post('/', async (req, res) => {
  await appRuntime.runPromise(
    Effect.gen(function* () {
      const body = yield* Schema.decodeUnknown(CreateShortlistBody)(req.body).pipe(
        Effect.mapError(() => new ValidationError({ message: 'projectId and name are required' }))
      )
      const shortlist = yield* createShortlist(body.projectId, body.name)
      yield* Effect.sync(() => res.status(201).json(shortlist))
    }).pipe(
      Effect.catchTag('ValidationError', (error) =>
        Effect.sync(() => res.status(400).json({ error: error.message }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      ),
    )
  )
})

shortlistsRouter.get('/:id', async (req, res) => {
  await appRuntime.runPromise(
    getShortlist(req.params.id).pipe(
      Effect.andThen((shortlist) => Effect.sync(() => res.json(shortlist))),
      Effect.catchTag('NotFoundError', () =>
        Effect.sync(() => res.status(404).json({ error: 'Shortlist not found' }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      ),
    )
  )
})

shortlistsRouter.put('/:id', async (req, res) => {
  await appRuntime.runPromise(
    Effect.gen(function* () {
      const body = yield* Schema.decodeUnknown(UpdateShortlistBody)(req.body).pipe(
        Effect.mapError(() => new ValidationError({ message: 'name is required' }))
      )

      const shortlist = yield* updateShortlist(req.params.id, body.name)
      yield* Effect.sync(() => res.json(shortlist))
    }).pipe(
      Effect.catchTag('ValidationError', (error) =>
        Effect.sync(() => res.status(400).json({ error: error.message }))
      ),
      Effect.catchTag('NotFoundError', () =>
        Effect.sync(() => res.status(404).json({ error: 'Shortlist not found' }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      ),
    )
  )
})

shortlistsRouter.delete('/:id', async (req, res) => {
  await appRuntime.runPromise(
    deleteShortlist(req.params.id).pipe(
      Effect.andThen((deleted) =>
        deleted
          ? Effect.sync(() => res.status(204).end())
          : Effect.sync(() => res.status(404).json({ error: 'Shortlist not found' }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      ),
    )
  )
})

shortlistsRouter.get('/:id/entries', async (req, res) => {
  await appRuntime.runPromise(
    listShortlistEntries(req.params.id).pipe(
      Effect.andThen((entries) => Effect.sync(() => res.json(entries))),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      ),
    )
  )
})

shortlistsRouter.post('/:id/entries', async (req, res) => {
  await appRuntime.runPromise(
    Effect.gen(function* () {
      const body = yield* Schema.decodeUnknown(AddShortlistEntryBody)(req.body).pipe(
        Effect.mapError(() => new ValidationError({ message: 'placeId is required' }))
      )

      const entry = yield* addShortlistEntry(req.params.id, body.placeId, body.notes)
      yield* Effect.sync(() => res.status(201).json(entry))
    }).pipe(
      Effect.catchTag('ValidationError', (error) =>
        Effect.sync(() => res.status(400).json({ error: error.message }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      ),
    )
  )
})

shortlistsRouter.get('/:id/entries/:placeId', async (req, res) => {
  await appRuntime.runPromise(
    getShortlistEntry(req.params.id, req.params.placeId).pipe(
      Effect.andThen((entry) => Effect.sync(() => res.json(entry))),
      Effect.catchTag('NotFoundError', () =>
        Effect.sync(() => res.status(404).json({ error: 'Shortlist entry not found' }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      ),
    )
  )
})

shortlistsRouter.put('/:id/entries/:placeId', async (req, res) => {
  await appRuntime.runPromise(
    Effect.gen(function* () {
      const body = yield* Schema.decodeUnknown(UpdateShortlistEntryBody)(req.body).pipe(
        Effect.mapError(() => new ValidationError({ message: 'notes is required' }))
      )

      const updatedEntry = yield* updateShortlistEntryNotes(req.params.id, req.params.placeId, body.notes)
      yield* Effect.sync(() => res.json(updatedEntry))
    }).pipe(
      Effect.catchTag('ValidationError', (error) =>
        Effect.sync(() => res.status(400).json({ error: error.message }))
      ),
      Effect.catchTag('NotFoundError', () =>
        Effect.sync(() => res.status(404).json({ error: 'Shortlist entry not found' }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      ),
    )
  )
})

shortlistsRouter.delete('/:id/entries/:placeId', async (req, res) => {
  await appRuntime.runPromise(
    removeShortlistEntry(req.params.id, req.params.placeId).pipe(
      Effect.andThen((deleted) =>
        deleted
          ? Effect.sync(() => res.status(204).end())
          : Effect.sync(() => res.status(404).json({ error: 'Shortlist entry not found' }))
      ),
      Effect.catchTag('DbError', (error) =>
        Effect.sync(() => res.status(500).json({ error: error.message }))
      ),
    )
  )
})
