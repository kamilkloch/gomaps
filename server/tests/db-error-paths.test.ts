import type Database from 'better-sqlite3'
import { Either, Effect, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import { Db } from '../src/db/Db.js'
import {
  addShortlistEntry,
  createPlace,
  createProject,
  createReview,
  createScrapeRun,
  createShortlist,
  createTile,
  deletePlace,
  deleteProject,
  deleteReview,
  deleteReviewsByPlace,
  deleteScrapeRun,
  deleteShortlist,
  deleteTile,
  getPlace,
  getProject,
  getReview,
  getScrapeRun,
  getShortlist,
  getShortlistEntry,
  getTile,
  linkPlaceToScrapeRun,
  listPlaceScrapeRuns,
  listPlaces,
  listProjects,
  listReviews,
  listScrapeRuns,
  listShortlistEntries,
  listShortlists,
  listTiles,
  removeShortlistEntry,
  truncateAllTables,
  unlinkPlaceFromScrapeRun,
  updatePlace,
  updateProject,
  updateScrapeRun,
  updateShortlist,
  updateShortlistEntryNotes,
  updateTile,
} from '../src/db/index.js'

type DbEffect = Effect.Effect<unknown, unknown, Db>

const createFailingDb = (message: string): Database.Database =>
  ({
    prepare: () => {
      throw new Error(message)
    },
    exec: () => {
      throw new Error(message)
    },
  }) as unknown as Database.Database

const runWithFailingDb = async (effect: DbEffect, message: string) => {
  const runtime = ManagedRuntime.make(Layer.succeed(Db, { db: createFailingDb(message) }))
  try {
    return await runtime.runPromise(effect.pipe(Effect.either))
  } finally {
    await runtime.dispose()
  }
}

const expectDbError = async (effect: DbEffect, operationName: string) => {
  const failureMessage = `forced failure (${operationName})`
  const result = await runWithFailingDb(effect, failureMessage)
  expect(Either.isLeft(result)).toBe(true)

  if (Either.isRight(result)) {
    return
  }

  const error = result.left as { _tag?: string; message?: string }
  expect(error._tag).toBe('DbError')
  expect(error.message).toContain(`Failed to ${operationName}`)
  expect(error.message).toContain(failureMessage)
}

const dbErrorCases: Array<{ label: string; operationName: string; effect: () => DbEffect }> = [
  { label: 'createProject', operationName: 'create project', effect: () => createProject('Error Project') },
  { label: 'getProject', operationName: 'get project', effect: () => getProject('missing-project') },
  { label: 'listProjects', operationName: 'list projects', effect: () => listProjects() },
  {
    label: 'updateProject',
    operationName: 'update project',
    effect: () => updateProject('missing-project', { name: 'Updated Name' }),
  },
  { label: 'deleteProject', operationName: 'delete project', effect: () => deleteProject('missing-project') },
  {
    label: 'createPlace',
    operationName: 'create place',
    effect: () =>
      createPlace({
        id: 'error-place',
        googleMapsUri: 'https://maps.google.com/?cid=error-place',
        name: 'Error Place',
        lat: 40,
        lng: 9,
      }),
  },
  { label: 'getPlace', operationName: 'get place', effect: () => getPlace('missing-place') },
  { label: 'listPlaces', operationName: 'list places', effect: () => listPlaces() },
  {
    label: 'updatePlace',
    operationName: 'update place',
    effect: () => updatePlace('missing-place', { name: 'Updated Place' }),
  },
  { label: 'deletePlace', operationName: 'delete place', effect: () => deletePlace('missing-place') },
  {
    label: 'createScrapeRun',
    operationName: 'create scrape run',
    effect: () => createScrapeRun('missing-project', 'hotels'),
  },
  { label: 'getScrapeRun', operationName: 'get scrape run', effect: () => getScrapeRun('missing-run') },
  { label: 'listScrapeRuns', operationName: 'list scrape runs', effect: () => listScrapeRuns('missing-project') },
  {
    label: 'updateScrapeRun',
    operationName: 'update scrape run',
    effect: () => updateScrapeRun('missing-run', { status: 'running' }),
  },
  { label: 'deleteScrapeRun', operationName: 'delete scrape run', effect: () => deleteScrapeRun('missing-run') },
  {
    label: 'createTile',
    operationName: 'create tile',
    effect: () => createTile('missing-run', '{"sw":[0,0],"ne":[1,1]}', 12),
  },
  { label: 'getTile', operationName: 'get tile', effect: () => getTile('missing-tile') },
  { label: 'listTiles', operationName: 'list tiles', effect: () => listTiles('missing-run') },
  {
    label: 'updateTile',
    operationName: 'update tile',
    effect: () => updateTile('missing-tile', { status: 'completed' }),
  },
  { label: 'deleteTile', operationName: 'delete tile', effect: () => deleteTile('missing-tile') },
  {
    label: 'createReview',
    operationName: 'create review',
    effect: () => createReview('missing-place', 5, 'Excellent'),
  },
  { label: 'getReview', operationName: 'get review', effect: () => getReview('missing-review') },
  { label: 'listReviews', operationName: 'list reviews', effect: () => listReviews('missing-place') },
  { label: 'deleteReview', operationName: 'delete review', effect: () => deleteReview('missing-review') },
  {
    label: 'deleteReviewsByPlace',
    operationName: 'delete reviews',
    effect: () => deleteReviewsByPlace('missing-place'),
  },
  {
    label: 'linkPlaceToScrapeRun',
    operationName: 'link place to scrape run',
    effect: () => linkPlaceToScrapeRun('missing-place', 'missing-run'),
  },
  {
    label: 'listPlaceScrapeRuns',
    operationName: 'list place scrape runs',
    effect: () => listPlaceScrapeRuns('missing-run'),
  },
  {
    label: 'unlinkPlaceFromScrapeRun',
    operationName: 'unlink place from scrape run',
    effect: () => unlinkPlaceFromScrapeRun('missing-place', 'missing-run'),
  },
  {
    label: 'createShortlist',
    operationName: 'create shortlist',
    effect: () => createShortlist('missing-project', 'Favorites'),
  },
  { label: 'getShortlist', operationName: 'get shortlist', effect: () => getShortlist('missing-shortlist') },
  {
    label: 'listShortlists',
    operationName: 'list shortlists',
    effect: () => listShortlists('missing-project'),
  },
  {
    label: 'updateShortlist',
    operationName: 'update shortlist',
    effect: () => updateShortlist('missing-shortlist', 'Renamed'),
  },
  {
    label: 'deleteShortlist',
    operationName: 'delete shortlist',
    effect: () => deleteShortlist('missing-shortlist'),
  },
  {
    label: 'addShortlistEntry',
    operationName: 'add shortlist entry',
    effect: () => addShortlistEntry('missing-shortlist', 'missing-place', 'Notes'),
  },
  {
    label: 'getShortlistEntry',
    operationName: 'get shortlist entry',
    effect: () => getShortlistEntry('missing-shortlist', 'missing-place'),
  },
  {
    label: 'listShortlistEntries',
    operationName: 'list shortlist entries',
    effect: () => listShortlistEntries('missing-shortlist'),
  },
  {
    label: 'updateShortlistEntryNotes',
    operationName: 'update shortlist entry notes',
    effect: () => updateShortlistEntryNotes('missing-shortlist', 'missing-place', 'Updated notes'),
  },
  {
    label: 'removeShortlistEntry',
    operationName: 'remove shortlist entry',
    effect: () => removeShortlistEntry('missing-shortlist', 'missing-place'),
  },
  {
    label: 'truncateAllTables',
    operationName: 'truncate test database tables',
    effect: () => truncateAllTables(),
  },
]

describe('db error paths', () => {
  for (const testCase of dbErrorCases) {
    it(`${testCase.label} maps db throws to DbError`, async () => {
      await expectDbError(testCase.effect(), testCase.operationName)
    })
  }
})
