import { createHash } from 'node:crypto'

export function normalizePlaceUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (!u.pathname.includes('/place/')) {
      return null
    }
    return `${u.origin}${u.pathname}`
  } catch {
    return null
  }
}

export function parseLatLngFromUrl(url: string): { lat: number | null; lng: number | null } {
  const match = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (!match) {
    return { lat: null, lng: null }
  }
  return { lat: Number(match[1]), lng: Number(match[2]) }
}

export function generatePlaceId(googleUrl: string): string {
  return createHash('sha256').update(googleUrl).digest('hex').slice(0, 16)
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
