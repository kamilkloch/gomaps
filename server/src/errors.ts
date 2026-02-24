import { Data } from 'effect'

export class DbError extends Data.TaggedError('DbError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class NotFoundError extends Data.TaggedError('NotFoundError')<{
  readonly entity: string
  readonly id: string
}> {}

export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly message: string
}> {}

export class ScrapeError extends Data.TaggedError('ScrapeError')<{
  readonly message: string
  readonly cause?: unknown
}> {}
