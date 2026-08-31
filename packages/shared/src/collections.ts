/**
 * Single source of truth for Firestore paths, so collection names are never
 * spelled out as string literals at call sites.
 */
export const COLLECTIONS = {
  users: "users",
  directory: "directory",
  registrations: "registrations",
  sessions: "sessions",
  speakers: "speakers",
  sponsors: "sponsors",
  tracks: "tracks",
  rooms: "rooms",
  threads: "threads",
  communityPosts: "communityPosts",
  announcements: "announcements",
  checkInLists: "checkInLists",
  checkInStations: "checkInStations",
  scanEvents: "scanEvents",
  badgeTemplates: "badgeTemplates",
  badgePrintJobs: "badgePrintJobs",
  ticketTypes: "ticketTypes",
  orders: "orders",
  /**
   * Server-only. Written by the website when it sends a transactional email,
   * read by the dashboard to answer "did the confirmation actually go out?".
   */
  emailLog: "emailLog",
  /** Organizer-authored preference bags, one document per feature area. */
  settings: "settings",
  /**
   * Editable copy for the public website's prose pages, one document per page.
   *
   * Server-only, and it must stay that way: the website renders it with the
   * Admin SDK and no client anywhere reads it, so it has no `firestore.rules`
   * match block. See `page-content.ts` for which fields of which pages are
   * editable and — more usefully — which are deliberately not.
   */
  pageContent: "pageContent",
  /**
   * Server-only. Carries the booking contact, the staff-pass allocation and
   * whether the space is confirmed or merely provisional — none of which an
   * attendee may see. The app reads `exhibitorListings` instead.
   */
  exhibitors: "exhibitors",
  /**
   * The slim, attendee-readable projection of `exhibitors/{id}` — the same
   * relationship `directory` has to `users`. See `ExhibitorListingDoc`.
   */
  exhibitorListings: "exhibitorListings",
  /** The exhibition floor plan, one document per sellable space. Server-only. */
  booths: "booths",
  /** Round tables and bookable meeting slots — an organizer's plan, not an app feature. */
  gatherings: "gatherings",
  /** Marketing contacts — people to email who hold no ticket. */
  contacts: "contacts",
  /** Tracked short links, counted by the redirect route itself. */
  campaignLinks: "campaignLinks",
  /** Registration question forms, one document per audience. */
  questionForms: "questionForms",
  /**
   * Server-only. Question answers held between the checkout form and the
   * webhook that confirms payment. Holds dietary and accessibility data; it has
   * no rules match block and must not get one.
   */
  pendingAnswers: "pendingAnswers",
  /** The organizing team's own checklist — not attendee-facing. */
  tasks: "tasks",
  surveys: "surveys",
  documents: "documents",
  /** Server-only: written and read by Cloud Functions with the Admin SDK. */
  otpCodes: "otpCodes",
  rateLimits: "rateLimits",
  auditLog: "auditLog",
} as const;

export const SUBCOLLECTIONS = {
  savedSessions: "savedSessions",
  savedContacts: "savedContacts",
  notifications: "notifications",
  fcmTokens: "fcmTokens",
  entitlements: "entitlements",
  messages: "messages",
  replies: "replies",
  reactions: "reactions",
  questions: "questions",
  upvotes: "upvotes",
  qaBoard: "qaBoard",
  polls: "polls",
  votes: "votes",
  materials: "materials",
  leads: "leads",
  checkIns: "checkIns",
  responses: "responses",
  /**
   * `users/{uid}/gatherings/{gatheringId}` — the attendee's own seat, as a
   * projection of the organizer's plan. Deliberately NOT the top-level
   * `gatherings` collection, which carries every other name at the table and
   * the organizer's notes; see `GatheringPlacementDoc`.
   */
  gatherings: "gatherings",
} as const;

/** The single document inside `sessions/{id}/qaBoard`. */
export const QA_BOARD_DOC = "current";

/**
 * `checkInLists/{DOOR_CHECK_IN_LIST_ID}` — the main entrance.
 *
 * A fixed id rather than a generated one, for two reasons. Two console tabs
 * racing to seed the door list produce one document, because the second
 * `create()` fails with `already-exists`. And the attendee app has to be able to
 * read its own check-in status without first listing every check-in list — it
 * knows the path because the id is a constant, which is also what keeps the
 * `checkInLists` read rule closed to attendees.
 *
 * It lives here rather than in either app because both sides must agree: the
 * console writes `checkInLists/event-door/checkIns/{registrationId}` and the
 * badge reads it. Two copies of the string would drift, and the failure would be
 * a badge that says "not checked in" to somebody who was.
 */
export const DOOR_CHECK_IN_LIST_ID = "event-door";

/**
 * A pair of uids always maps to the same thread id, so a pair maps to one
 * conversation. That is the whole of what this function guarantees.
 *
 * ⚠️ **Membership is NOT derivable from this id, and nothing may try.** The
 * `messages` rules prove membership by reading `participantIds` on the thread
 * document — one of only three `get()`s in `firestore.rules`, and deliberate.
 *
 * This docblock previously claimed the opposite: that the rules prove
 * membership from the path, because "Firebase uids are alphanumeric, so `_` is
 * an unambiguous separator". Both halves are false. Uids are not alphanumeric —
 * the demo accounts are `demo_000` and `demo_001`, so `demo_000_demo_001`
 * splits into four pieces containing neither participant, and **every message
 * read and send was denied**. It is the worst bug this repo has had, and the
 * comment justifying it read as entirely reasonable.
 *
 * `AGENTS.md` records that the same mistake was made independently in the
 * thread-title code and says a third instance is a bug. This comment was the
 * third instance, found 2026-08-31. If you find a fourth, the fix is not to
 * correct the comment.
 */
export function threadIdFor(uidA: string, uidB: string) {
  return [uidA, uidB].sort().join("_");
}

/**
 * Whether a uid is in a thread — the sanctioned answer, deliberately sitting
 * one line below the tempting one.
 *
 * ⚠️ These two helpers exist because correcting the comment stopped working.
 * The "membership is provable from the thread id" claim has now been written
 * four separate times in this repo: in the rules, in the thread-title code, in
 * `threadIdFor`'s own docblock, and in `ThreadDoc`'s. Each was corrected; each
 * time it came back, because `threadIdFor` *looks* like it encodes membership
 * and the next author reaches for the obvious thing.
 *
 * So the fix is no longer a comment. It is having the right function in the
 * same file as the misleading one, so "how do I tell if this person is in this
 * thread" has an answer that is easier to find than `id.split('_')`.
 *
 * Takes the array rather than the document, so this file keeps its promise of
 * importing nothing.
 */
export function isThreadParticipant(
  participantIds: readonly string[] | undefined,
  uid: string,
): boolean {
  return participantIds?.includes(uid) ?? false;
}

/**
 * The other person in a two-party thread, or `undefined` if `uid` is not in it.
 *
 * Returns `undefined` rather than falling back to `uid` on a non-member: a
 * caller that renders the fallback shows somebody their own name where a
 * correspondent should be, which reads as a display bug rather than as the
 * access error it is.
 */
export function correspondentIn(
  participantIds: readonly string[] | undefined,
  uid: string,
): string | undefined {
  if (!isThreadParticipant(participantIds, uid)) return undefined;
  return participantIds!.find((p) => p !== uid);
}

/**
 * A scan is identified by the device that made it plus that device's own
 * counter, so replaying an offline queue writes to the same ids twice and the
 * second `create` fails with `already-exists` rather than double-counting.
 */
export function scanEventIdFor(deviceId: string, clientScanId: string) {
  return `${deviceId}_${clientScanId}`;
}
