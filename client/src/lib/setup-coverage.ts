export interface SetupBounds {
  sw: { lat: number; lng: number }
  ne: { lat: number; lng: number }
}

export interface SetupCoverageSourceTile {
  scrapeRunId: string
  bounds: SetupBounds
}

export interface SetupSelectionCoverageSummary {
  coveredAreaRatio: number
  coveredPercentage: number
  contributingRunCount: number
  coveredBounds: SetupBounds[]
  uncoveredBounds: SetupBounds[]
}

export const parseSetupBounds = (rawBounds: string | null): SetupBounds | null => {
  if (!rawBounds) {
    return null
  }

  try {
    const parsed = JSON.parse(rawBounds) as SetupBounds
    if (
      Number.isFinite(parsed.sw.lat)
      && Number.isFinite(parsed.sw.lng)
      && Number.isFinite(parsed.ne.lat)
      && Number.isFinite(parsed.ne.lng)
      && parsed.sw.lat < parsed.ne.lat
      && parsed.sw.lng < parsed.ne.lng
    ) {
      return parsed
    }
  }
  catch {
    return null
  }

  return null
}

export const computeSelectionCoverageSummary = (
  selectionBounds: SetupBounds | null,
  aggregateCoverageBounds: SetupBounds[],
  sourceTiles: SetupCoverageSourceTile[],
): SetupSelectionCoverageSummary | null => {
  if (!selectionBounds) {
    return null
  }

  const coveredBounds = aggregateCoverageBounds
    .map((bounds) => intersectBounds(selectionBounds, bounds))
    .filter(isDefined)
  const coveredArea = coveredBounds.reduce((total, bounds) => total + getBoundsArea(bounds), 0)
  const selectionArea = getBoundsArea(selectionBounds)
  const coveredAreaRatio = coveredArea / selectionArea

  return {
    coveredAreaRatio,
    coveredPercentage: Math.min(100, Math.max(0, Math.round(coveredAreaRatio * 100))),
    contributingRunCount: new Set(
      sourceTiles
        .filter((tile) => intersectBounds(selectionBounds, tile.bounds))
        .map((tile) => tile.scrapeRunId),
    ).size,
    coveredBounds,
    uncoveredBounds: computeUncoveredBounds(selectionBounds, coveredBounds),
  }
}

const computeUncoveredBounds = (
  selectionBounds: SetupBounds,
  coveredBounds: SetupBounds[],
): SetupBounds[] => {
  if (coveredBounds.length === 0) {
    return [selectionBounds]
  }

  const latPoints = Array.from(
    new Set([selectionBounds.sw.lat, selectionBounds.ne.lat, ...coveredBounds.flatMap((bounds) => [bounds.sw.lat, bounds.ne.lat])]),
  ).sort((left, right) => left - right)
  const lngPoints = Array.from(
    new Set([selectionBounds.sw.lng, selectionBounds.ne.lng, ...coveredBounds.flatMap((bounds) => [bounds.sw.lng, bounds.ne.lng])]),
  ).sort((left, right) => left - right)

  const uncoveredCells = latPoints.slice(0, -1).map(() =>
    lngPoints.slice(0, -1).map(() => false),
  )

  for (let latIndex = 0; latIndex < latPoints.length - 1; latIndex += 1) {
    const south = latPoints[latIndex]
    const north = latPoints[latIndex + 1]

    for (let lngIndex = 0; lngIndex < lngPoints.length - 1; lngIndex += 1) {
      const west = lngPoints[lngIndex]
      const east = lngPoints[lngIndex + 1]

      const cellBounds = {
        sw: { lat: south, lng: west },
        ne: { lat: north, lng: east },
      }
      uncoveredCells[latIndex][lngIndex] = !coveredBounds.some((bounds) => containsBounds(bounds, cellBounds))
    }
  }

  return mergeCoverageCells(uncoveredCells, latPoints, lngPoints)
}

const mergeCoverageCells = (
  cells: boolean[][],
  latPoints: number[],
  lngPoints: number[],
): SetupBounds[] => {
  const activeSegments = new Map<string, CoverageSegment>()
  const mergedBounds: SetupBounds[] = []

  for (let latIndex = 0; latIndex < cells.length; latIndex += 1) {
    const rowSegments: CoverageSegment[] = []
    let lngIndex = 0

    while (lngIndex < cells[latIndex].length) {
      if (!cells[latIndex][lngIndex]) {
        lngIndex += 1
        continue
      }

      const startIndex = lngIndex
      while (lngIndex < cells[latIndex].length && cells[latIndex][lngIndex]) {
        lngIndex += 1
      }

      rowSegments.push({
        westIndex: startIndex,
        eastIndex: lngIndex,
        south: latPoints[latIndex],
        north: latPoints[latIndex + 1],
      })
    }

    const nextActiveSegments = new Map<string, CoverageSegment>()

    for (const segment of rowSegments) {
      const key = `${segment.westIndex}:${segment.eastIndex}`
      const existing = activeSegments.get(key)
      if (existing) {
        nextActiveSegments.set(key, {
          ...existing,
          north: segment.north,
        })
        activeSegments.delete(key)
        continue
      }

      nextActiveSegments.set(key, segment)
    }

    for (const segment of activeSegments.values()) {
      mergedBounds.push(segmentToBounds(segment, lngPoints))
    }

    activeSegments.clear()
    for (const [key, segment] of nextActiveSegments.entries()) {
      activeSegments.set(key, segment)
    }
  }

  for (const segment of activeSegments.values()) {
    mergedBounds.push(segmentToBounds(segment, lngPoints))
  }

  return mergedBounds
}

interface CoverageSegment {
  westIndex: number
  eastIndex: number
  south: number
  north: number
}

const segmentToBounds = (
  segment: CoverageSegment,
  lngPoints: number[],
): SetupBounds => ({
  sw: {
    lat: segment.south,
    lng: lngPoints[segment.westIndex],
  },
  ne: {
    lat: segment.north,
    lng: lngPoints[segment.eastIndex],
  },
})

const intersectBounds = (first: SetupBounds, second: SetupBounds): SetupBounds | null => {
  const south = Math.max(first.sw.lat, second.sw.lat)
  const west = Math.max(first.sw.lng, second.sw.lng)
  const north = Math.min(first.ne.lat, second.ne.lat)
  const east = Math.min(first.ne.lng, second.ne.lng)

  if (south >= north || west >= east) {
    return null
  }

  return {
    sw: { lat: south, lng: west },
    ne: { lat: north, lng: east },
  }
}

const containsBounds = (container: SetupBounds, candidate: SetupBounds): boolean =>
  candidate.sw.lat >= container.sw.lat
  && candidate.sw.lng >= container.sw.lng
  && candidate.ne.lat <= container.ne.lat
  && candidate.ne.lng <= container.ne.lng

const getBoundsArea = (bounds: SetupBounds): number =>
  (bounds.ne.lat - bounds.sw.lat) * (bounds.ne.lng - bounds.sw.lng)

const isDefined = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined
