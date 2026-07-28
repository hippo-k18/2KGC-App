/** Event-wide constants. Change these once per year, not per screen. */
export const EVENT = {
  name: 'Knowledge Graph Conference 2026',
  shortName: 'KGC',
  website: 'https://www.knowledgegraph.tech/',
  venue: 'Cornell Tech, Roosevelt Island, New York, NY',
  /** Sessions are authored in this zone; attendees may be anywhere. */
  timeZone: 'America/New_York',
} as const;

/** Routes reachable without a session. Everything else redirects to /login. */
export const PUBLIC_ROUTES = ['/login'] as const;
