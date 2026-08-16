/**
 * Event-wide constants shared by the app, Cloud Functions and the importer.
 *
 * These live here rather than in the app because the importer derives `day`
 * from `TIME_ZONE` server-side, and every document written anywhere carries
 * `EVENT_ID`. Two copies of either would drift, and the failure would be
 * invisible until a session landed on the wrong day tab.
 */

/**
 * Stamped onto every top-level document. Change once per cycle, in this file
 * only — never as a string literal at a call site, same rule as `COLLECTIONS`.
 */
export const EVENT_ID = "kgc-2027";

/**
 * Sessions are authored in this zone; attendees may be anywhere.
 *
 * The wall-clock strings on `SessionDoc` are interpreted against this, and
 * `day` is derived from it. A 21:00 reception is 01:00 UTC the following day,
 * so deriving `day` in any other zone puts it on the wrong tab.
 */
export const TIME_ZONE = "America/New_York";

export const EVENT = {
  id: EVENT_ID,
  name: "Knowledge Graph Conference 2027",
  shortName: "KGC",
  website: "https://www.knowledgegraph.tech/",
  venue: "Cornell Tech, Roosevelt Island, New York, NY",
  timeZone: TIME_ZONE,
} as const;
