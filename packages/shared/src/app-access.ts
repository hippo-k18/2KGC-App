/**
 * `settings/appAccess` — the three organizer settings a phone has to obey.
 *
 * ── Why a second document, when `settings/access` already holds these ───────
 *
 * `settings/access` is the authoring bag: it holds `staffNote`, written for the
 * check-in desk, beside the values below. Rules filter documents and not
 * fields, so opening that bag to a phone opens all of it. This is the same
 * answer `directory/{uid}` gives for `users/{uid}` and `exhibitorListings` for
 * `exhibitors`: a projection carrying only what the reader may have.
 *
 * Nobody types into it. `projectAppAccess()` derives it from the access bag and
 * the event's own dates, and the dashboard rewrites it on every save of either.
 * A value edited here by hand is a value the next save overwrites.
 *
 * ── Why epoch milliseconds ──────────────────────────────────────────────────
 *
 * `firestore.rules` reads this document too, and the only clock it has is
 * `request.time`. Comparing `request.time.toMillis()` against a stored number is
 * one integer comparison; there is no date parsing in the rules language, and a
 * stored ISO string would have to be trusted rather than compared. The app does
 * the same comparison against `Date.now()`, so the two surfaces cannot disagree
 * about when the window closes.
 *
 * ⚠️ `0` means "never", not "1970". An absent or zero cutoff is the open state
 * on both surfaces, which is what makes an unwritten projection fail open — the
 * safe direction for a conference whose app is the schedule.
 */

/** What the phone and the rules read. Every field is derived. */
export interface AppAccessProjection {
  /** Epoch ms after which the app refuses to open at all. `0` never closes. */
  closesAtMs: number;
  /** Epoch ms after which the app still opens but takes no writes. `0` never. */
  readOnlyFromMs: number;
  /** Event-wide switch for attendee-to-attendee messages. */
  messagingEnabled: boolean;
  /** The join code, upper case. `''` when none is set. */
  joinCode: string;
  /** Whether the app asks for the code before letting an attendee in. */
  joinCodeRequired: boolean;
}

/** Open, writable, messageable, no code. What an unwritten projection means. */
export const APP_ACCESS_DEFAULTS: AppAccessProjection = {
  closesAtMs: 0,
  readOnlyFromMs: 0,
  messagingEnabled: true,
  joinCode: "",
  joinCodeRequired: false,
};

/**
 * `open` — everything works.
 * `read-only` — the event is over but the app still opens; no new posts,
 *   messages or questions.
 * `closed` — the window has passed; the app shows one screen and nothing else.
 */
export type AppAccessState = "open" | "read-only" | "closed";

export function appAccessState(access: AppAccessProjection, nowMs: number): AppAccessState {
  if (access.closesAtMs > 0 && nowMs >= access.closesAtMs) return "closed";
  if (access.readOnlyFromMs > 0 && nowMs >= access.readOnlyFromMs) return "read-only";
  return "open";
}

/** Whether an attendee may write anything at all right now. */
export function appWritesOpen(access: AppAccessProjection, nowMs: number): boolean {
  return appAccessState(access, nowMs) === "open";
}

/**
 * `2027-05-07` + 30 → `2027-06-06`. Calendar arithmetic, in UTC on purpose.
 *
 * The date is a calendar day and not an instant, so it is moved with `Date.UTC`
 * rather than with a local `Date`: on a machine west of Greenwich
 * `new Date('2027-05-07')` is the 6th at 20:00, and adding a day to it lands on
 * the wrong date for half the world. The wall clock this produces is turned
 * into an instant by the caller, in the event's own zone.
 */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return isoDate;
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return moved.toISOString().slice(0, 10);
}

/**
 * The two wall clocks the window is built from: when writes stop and when the
 * app closes.
 *
 * Both land at `23:59` on the last day that still counts, because an organizer
 * who types "7 days of access after the event" means seven whole days, not six
 * and a bit. `null` means that end of the window is not set at all.
 *
 * Pure, and wall clock rather than an instant, because turning a wall clock
 * into an instant needs the event's time zone and a zone database — `@kgc/
 * scripts`' `fromWallClock` does that, on a server, and this package carries no
 * date library.
 */
export function accessWindowWallClocks(input: {
  endDate: string;
  postEventDays: number;
  postEventReadOnly: boolean;
}): { readOnlyFrom: string | null; closesAt: string | null } {
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(input.endDate) ? input.endDate : "";
  if (!endDate) return { readOnlyFrom: null, closesAt: null };

  const days = Number.isFinite(input.postEventDays) ? Math.max(0, Math.trunc(input.postEventDays)) : 0;

  return {
    // Read-only starts when the event itself is over, which is the day the
    // organizer's own checkbox describes as "afterwards".
    readOnlyFrom: input.postEventReadOnly ? `${endDate}T23:59` : null,
    closesAt: `${addDays(endDate, days)}T23:59`,
  };
}

/**
 * The code as it is stored and compared: upper case, no spaces or punctuation.
 *
 * It is read out from a stage and typed on a phone, so `kgc 2027` and `KGC-2027`
 * have to be the same code. Hyphens are allowed in what an organizer types and
 * dropped from the comparison, which is the only part of this that is not
 * obvious: the alternative is an attendee reading a hyphen off a slide, typing
 * it, and being refused.
 */
export function normaliseJoinCode(raw: string): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Whether what somebody typed is the code. False when no code is set. */
export function joinCodeMatches(expected: string, typed: string): boolean {
  const want = normaliseJoinCode(expected);
  return want.length > 0 && want === normaliseJoinCode(typed);
}

/**
 * Whether this attendee still has to type the code.
 *
 * Asked once, and `joinedAt` on the profile is the record that it was asked, so
 * the prompt does not come back on every launch. Somebody who was already using
 * the app when the code was switched on is asked the next time they open it:
 * they have no `joinedAt`, and an organizer who turns the switch on mid-event
 * is asking the room for the code, not only the people who arrive after.
 *
 * A null profile is never prompted. It means the profile has not loaded yet, and
 * a code box drawn over a loading screen is one an attendee answers before the
 * app knows whether it needed to ask.
 */
export function joinCodeNeeded(
  access: AppAccessProjection,
  profile: { joinedAt?: unknown } | null,
): boolean {
  if (!access.joinCodeRequired || normaliseJoinCode(access.joinCode).length === 0) return false;
  if (!profile) return false;
  return !profile.joinedAt;
}
