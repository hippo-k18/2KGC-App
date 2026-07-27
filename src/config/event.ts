/**
 * Event-wide constants. Everything here is public and safe to ship to the client.
 */
export const EVENT = {
  name: "Knowledge Graph Conference 2026",
  shortName: "KGC",
  website: "https://www.knowledgegraph.tech/",
  venue: "Cornell Tech, Roosevelt Island, New York, NY",
  /** Sessions are authored and displayed in this zone; attendees may be anywhere. */
  timeZone: "America/New_York",
} as const;

/** Routes reachable without a signed-in attendee. Everything else is gated. */
export const PUBLIC_ROUTES = ["/", "/login"] as const;

/** Routes a signed-in attendee must not linger on. */
export const AUTH_ROUTES = ["/login"] as const;
