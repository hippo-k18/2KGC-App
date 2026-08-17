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
 * A pair of uids always maps to the same thread id.
 *
 * This is also what lets the `messages` security rules prove membership from
 * the path instead of reading the parent thread document. Firebase uids are
 * alphanumeric, so `_` is an unambiguous separator.
 */
export function threadIdFor(uidA: string, uidB: string) {
  return [uidA, uidB].sort().join("_");
}

/**
 * A scan is identified by the device that made it plus that device's own
 * counter, so replaying an offline queue writes to the same ids twice and the
 * second `create` fails with `already-exists` rather than double-counting.
 */
export function scanEventIdFor(deviceId: string, clientScanId: string) {
  return `${deviceId}_${clientScanId}`;
}
