import { Router } from 'express'
import { Effect, Schema } from 'effect'
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
} from '../db/index.js'
import { ValidationError } from '../errors.js'
import { appRuntime } from '../runtime.js'

export const projectsRouter = Router()

const CreateProjectBody = Schema.Struct({
  name: Schema.String,
  bounds: Schema.optional(Schema.String),
})

const UpdateProjectBody = Schema.Struct({
  name: Schema.optional(Schema.String),
  bounds: Schema.optional(Schema.String),
})

projectsRouter.get('/', async (_req, res) => {
  await appRuntime.runPromise(
    listProjects().pipe(
      Effect.andThen((projects) => Effect.sync(() => res.json(projects))),
      Effect.catchTag('DbError', (e) =>
        Effect.sync(() => res.status(500).json({ error: e.message }))
      ),
    )
  )
})

projectsRouter.post('/', async (req, res) => {
  await appRuntime.runPromise(
    Effect.gen(function* () {
      const body = yield* Schema.decodeUnknown(CreateProjectBody)(req.body).pipe(
        Effect.mapError(() => new ValidationError({ message: 'name is required' }))
      )
      const project = yield* createProject(body.name, body.bounds)
      res.status(201).json(project)
    }).pipe(
      Effect.catchTag('ValidationError', (e) =>
        Effect.sync(() => res.status(400).json({ error: e.message }))
      ),
      Effect.catchTag('DbError', (e) =>
        Effect.sync(() => res.status(500).json({ error: e.message }))
      ),
    )
  )
})

projectsRouter.get('/:id', async (req, res) => {
  await appRuntime.runPromise(
    getProject(req.params.id).pipe(
      Effect.andThen((project) => Effect.sync(() => res.json(project))),
      Effect.catchTag('NotFoundError', () =>
        Effect.sync(() => res.status(404).json({ error: 'Project not found' }))
      ),
      Effect.catchTag('DbError', (e) =>
        Effect.sync(() => res.status(500).json({ error: e.message }))
      ),
    )
  )
})

projectsRouter.put('/:id', async (req, res) => {
  await appRuntime.runPromise(
    Effect.gen(function* () {
      const body = yield* Schema.decodeUnknown(UpdateProjectBody)(req.body).pipe(
        Effect.mapError(() => new ValidationError({ message: 'Invalid request body' }))
      )
      const project = yield* updateProject(req.params.id, { name: body.name, bounds: body.bounds })
      res.json(project)
    }).pipe(
      Effect.catchTag('NotFoundError', () =>
        Effect.sync(() => res.status(404).json({ error: 'Project not found' }))
      ),
      Effect.catchTag('ValidationError', (e) =>
        Effect.sync(() => res.status(400).json({ error: e.message }))
      ),
      Effect.catchTag('DbError', (e) =>
        Effect.sync(() => res.status(500).json({ error: e.message }))
      ),
    )
  )
})

projectsRouter.delete('/:id', async (req, res) => {
  await appRuntime.runPromise(
    deleteProject(req.params.id).pipe(
      Effect.andThen(() => Effect.sync(() => res.status(204).end())),
      Effect.catchTag('NotFoundError', () =>
        Effect.sync(() => res.status(404).json({ error: 'Project not found' }))
      ),
      Effect.catchTag('DbError', (e) =>
        Effect.sync(() => res.status(500).json({ error: e.message }))
      ),
    )
  )
})
