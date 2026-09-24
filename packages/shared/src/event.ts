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

/**
 * The mailbox KGC publishes to the public.
 *
 * It is here rather than in `apps/web`'s `site.ts` — where the rest of the
 * site's presentation strings live — because two installs that cannot import
 * each other now have to name the *same* address. `apps/web` prints it on
 * `/code-of-conduct` when no reporting address has been set for this edition,
 * and `apps/organizer` prints it on Content > Basics > Website Copy so that an
 * organizer can see which address the public page is currently using. A second
 * copy of this string would let the dashboard tell an organizer the page says
 * one thing while it said another, which is the whole failure the screen exists
 * to prevent.
 *
 * It is a fact about the conference, not copy: the same class of thing as
 * `website` and `venue` beside it. `EMAIL_REPLY_TO` in `@kgc/scripts` is a
 * different address for a different job — it is where a ticket receipt's
 * replies land, and it is configurable per deployment.
 */
const CONTACT_EMAIL = "contact@knowledgegraph.tech";

export const EVENT = {
  id: EVENT_ID,
  name: "Knowledge Graph Conference 2027",
  shortName: "KGC",
  website: "https://www.knowledgegraph.tech/",
  venue: "Bryant Park, New York, NY",
  timeZone: TIME_ZONE,
  contactEmail: CONTACT_EMAIL,
} as const;
