import { describe, expect, it } from 'vitest'
import {
  computeSelectionCoverageSummary,
  parseSetupBounds,
  type SetupBounds,
} from './setup-coverage'

describe('setup coverage helpers', () => {
  it('returns null when bounds input is empty', () => {
    expect(parseSetupBounds(null)).toBeNull()
  })

  it('parses valid bounds JSON', () => {
    expect(
      parseSetupBounds(JSON.stringify({
        sw: { lat: 40, lng: 9 },
        ne: { lat: 41, lng: 10 },
      })),
    ).toEqual({
      sw: { lat: 40, lng: 9 },
      ne: { lat: 41, lng: 10 },
    })
  })

  it('returns null for invalid bounds JSON', () => {
    expect(parseSetupBounds('{"sw":{"lat":40,"lng":9},"ne":{"lat":40,"lng":10}}')).toBeNull()
    expect(parseSetupBounds('{')).toBeNull()
  })

  it('returns null coverage summary when there is no current selection', () => {
    expect(computeSelectionCoverageSummary(null, [], [])).toBeNull()
  })

  it('computes partial selection coverage without double-counting overlaps', () => {
    const selectionBounds: SetupBounds = {
      sw: { lat: 0, lng: 0 },
      ne: { lat: 2, lng: 2 },
    }

    const summary = computeSelectionCoverageSummary(
      selectionBounds,
      [
        {
          sw: { lat: 0, lng: 0 },
          ne: { lat: 2, lng: 1.5 },
        },
      ],
      [
        {
          scrapeRunId: 'run-a',
          bounds: {
            sw: { lat: 0, lng: 0 },
            ne: { lat: 2, lng: 1 },
          },
        },
        {
          scrapeRunId: 'run-b',
          bounds: {
            sw: { lat: 0, lng: 0.5 },
            ne: { lat: 2, lng: 1.5 },
          },
        },
        {
          scrapeRunId: 'run-b',
          bounds: {
            sw: { lat: 0, lng: 0.75 },
            ne: { lat: 2, lng: 1.5 },
          },
        },
      ],
    )

    expect(summary).toMatchObject({
      coveredPercentage: 75,
      contributingRunCount: 2,
    })
    expect(summary?.uncoveredBounds).toEqual([
      {
        sw: { lat: 0, lng: 1.5 },
        ne: { lat: 2, lng: 2 },
      },
    ])
  })

  it('returns the full selection as uncovered when no coverage intersects it', () => {
    const selectionBounds: SetupBounds = {
      sw: { lat: 0, lng: 0 },
      ne: { lat: 1, lng: 1 },
    }

    const summary = computeSelectionCoverageSummary(
      selectionBounds,
      [
        {
          sw: { lat: 2, lng: 2 },
          ne: { lat: 3, lng: 3 },
        },
      ],
      [],
    )

    expect(summary).toMatchObject({
      coveredPercentage: 0,
      contributingRunCount: 0,
    })
    expect(summary?.uncoveredBounds).toEqual([selectionBounds])
  })

  it('returns no uncovered bounds when the selection is fully covered', () => {
    const selectionBounds: SetupBounds = {
      sw: { lat: 0, lng: 0 },
      ne: { lat: 2, lng: 2 },
    }

    const summary = computeSelectionCoverageSummary(
      selectionBounds,
      [selectionBounds],
      [
        {
          scrapeRunId: 'run-a',
          bounds: selectionBounds,
        },
      ],
    )

    expect(summary).toMatchObject({
      coveredAreaRatio: 1,
      coveredPercentage: 100,
      contributingRunCount: 1,
    })
    expect(summary?.coveredBounds).toEqual([selectionBounds])
    expect(summary?.uncoveredBounds).toEqual([])
  })

  it('splits uncovered gaps when row spans change across the selection', () => {
    const selectionBounds: SetupBounds = {
      sw: { lat: 0, lng: 0 },
      ne: { lat: 2, lng: 2 },
    }

    const summary = computeSelectionCoverageSummary(
      selectionBounds,
      [
        {
          sw: { lat: 0, lng: 1 },
          ne: { lat: 1, lng: 2 },
        },
      ],
      [
        {
          scrapeRunId: 'run-a',
          bounds: {
            sw: { lat: 0, lng: 1 },
            ne: { lat: 1, lng: 2 },
          },
        },
      ],
    )

    expect(summary).toMatchObject({
      coveredPercentage: 25,
      contributingRunCount: 1,
    })
    expect(summary?.uncoveredBounds).toEqual([
      {
        sw: { lat: 0, lng: 0 },
        ne: { lat: 1, lng: 1 },
      },
      {
        sw: { lat: 1, lng: 0 },
        ne: { lat: 2, lng: 2 },
      },
    ])
  })

  it('merges uncovered gaps vertically when consecutive rows share the same span', () => {
    const selectionBounds: SetupBounds = {
      sw: { lat: 0, lng: 0 },
      ne: { lat: 2, lng: 2 },
    }

    const summary = computeSelectionCoverageSummary(
      selectionBounds,
      [
        {
          sw: { lat: 0, lng: 0 },
          ne: { lat: 1, lng: 1 },
        },
        {
          sw: { lat: 1, lng: 0 },
          ne: { lat: 2, lng: 1 },
        },
      ],
      [
        {
          scrapeRunId: 'run-a',
          bounds: {
            sw: { lat: 0, lng: 0 },
            ne: { lat: 1, lng: 1 },
          },
        },
        {
          scrapeRunId: 'run-b',
          bounds: {
            sw: { lat: 1, lng: 0 },
            ne: { lat: 2, lng: 1 },
          },
        },
      ],
    )

    expect(summary).toMatchObject({
      coveredPercentage: 50,
      contributingRunCount: 2,
    })
    expect(summary?.uncoveredBounds).toEqual([
      {
        sw: { lat: 0, lng: 1 },
        ne: { lat: 2, lng: 2 },
      },
    ])
  })
})
