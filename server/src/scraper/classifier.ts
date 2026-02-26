const OTA_DOMAINS = new Set([
  'booking.com',
  'airbnb.com',
  'expedia.com',
  'hotels.com',
  'vrbo.com',
  'agoda.com',
  'tripadvisor.com',
  'hostelworld.com',
  'kayak.com',
  'priceline.com',
  'trivago.com',
  'orbitz.com',
  'travelocity.com',
  'hotwire.com',
  'ebookers.com',
  'wotif.com',
  'lastminute.com',
  'expedia.co.uk',
  'booking.co.uk',
])

const SOCIAL_DOMAINS = new Set([
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'linkedin.com',
  'pinterest.com',
])

export type WebsiteType = 'direct' | 'ota' | 'social' | 'unknown'

export const classifyWebsite = (value: string | null | undefined): WebsiteType => {
  if (!value) {
    return 'unknown'
  }

  const hostname = extractHostname(value)
  if (!hostname) {
    return 'unknown'
  }

  if (matchesDomainSet(hostname, OTA_DOMAINS)) {
    return 'ota'
  }

  if (matchesDomainSet(hostname, SOCIAL_DOMAINS)) {
    return 'social'
  }

  return 'direct'
}

const extractHostname = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const parsed = new URL(candidate)
    const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '')
    return hostname || null
  } catch {
    return null
  }
}

const matchesDomainSet = (hostname: string, domains: ReadonlySet<string>): boolean => {
  for (const domain of domains) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return true
    }
  }

  return false
}
