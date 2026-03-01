import { Effect } from 'effect'
import { DbError } from '../errors.js'

export const tryDb = <A>(operationName: string, execute: () => A): Effect.Effect<A, DbError> =>
  Effect.try({
    try: execute,
    catch: (cause) =>
      new DbError({
        message: `Failed to ${operationName}: ${String(cause)}`,
        cause,
      }),
  })
