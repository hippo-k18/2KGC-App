/**
 * Single source of truth for Firestore paths, so collection names are never
 * spelled out as string literals at call sites.
 */
export const COLLECTIONS = {
  users: "users",
  registrations: "registrations",
  sessions: "sessions",
  speakers: "speakers",
  sponsors: "sponsors",
  tracks: "tracks",
  threads: "threads",
  communityPosts: "communityPosts",
  announcements: "announcements",
} as const;

export const SUBCOLLECTIONS = {
  savedSessions: "savedSessions",
  savedContacts: "savedContacts",
  notifications: "notifications",
  fcmTokens: "fcmTokens",
  messages: "messages",
  replies: "replies",
  reactions: "reactions",
  questions: "questions",
  upvotes: "upvotes",
  polls: "polls",
  leads: "leads",
} as const;

/** A pair of uids always maps to the same thread id. */
export function threadIdFor(uidA: string, uidB: string) {
  return [uidA, uidB].sort().join("_");
}
