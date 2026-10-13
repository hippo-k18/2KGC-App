/**
 * Reporting, blocking and the word filter: the parts every surface shares.
 *
 * App Store guideline 1.2 asks an app with user-generated content for four
 * things: a way to report content, a way to block abusive users, a filter on
 * what gets posted, and a contact for the people running it. The app, the
 * dashboard's Reports queue and `firestore.rules` all read the lists in this
 * file, so the reasons a phone offers are the ones the rules accept and the
 * dashboard can name.
 *
 * Pure, so it is tested without an emulator (`moderation-core.test.ts`).
 */

export const REPORT_TARGET_TYPES = ["job", "communityPost", "reply", "message", "user"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS = [
  { id: "spam", label: "Spam" },
  { id: "offensive", label: "Offensive or abusive" },
  { id: "scam", label: "Scam or fraud" },
  { id: "other", label: "Something else" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

export const REPORT_NOTE_MAX = 500;

export function reportReasonLabel(id: string): string {
  return REPORT_REASONS.find((r) => r.id === id)?.label ?? id;
}

/** What a report points at, in the shape each surface already has to hand. */
export type ReportTarget =
  | { type: "communityPost"; postId: string }
  | { type: "reply"; postId: string; replyId: string }
  | { type: "message"; threadId: string; messageId?: string }
  | { type: "user"; uid: string }
  | { type: "job"; jobId: string };

/**
 * A stable key for the target, used in the report's id.
 *
 * The id is `<reporterId>__<targetKey>`, and the rules require exactly that, so
 * reporting the same thing twice is a `create` on a document that already
 * exists. That refusal is the de-duplication: one person cannot fill the queue
 * by tapping Report ten times. Colons separate the parts because no Firestore
 * id in this project contains one, and a slash is not allowed in an id at all.
 */
export function reportTargetKey(t: ReportTarget): string {
  switch (t.type) {
    case "communityPost":
      return `communityPost:${t.postId}`;
    case "reply":
      return `reply:${t.postId}:${t.replyId}`;
    case "message":
      return t.messageId ? `message:${t.threadId}:${t.messageId}` : `message:${t.threadId}`;
    case "user":
      return `user:${t.uid}`;
    case "job":
      return `job:${t.jobId}`;
  }
}

/** The Firestore path the dashboard opens to see and hide what was reported. */
export function reportTargetPath(t: ReportTarget): string {
  switch (t.type) {
    case "communityPost":
      return `communityPosts/${t.postId}`;
    case "reply":
      return `communityPosts/${t.postId}/replies/${t.replyId}`;
    case "message":
      return t.messageId ? `threads/${t.threadId}/messages/${t.messageId}` : `threads/${t.threadId}`;
    case "user":
      return `directory/${t.uid}`;
    case "job":
      return `jobs/${t.jobId}`;
  }
}

export function reportId(reporterId: string, t: ReportTarget): string {
  return `${reporterId}__${reportTargetKey(t)}`;
}

/** Who is filtered out for `me`: anyone I blocked. */
export function isHiddenBy(blocked: ReadonlySet<string> | null | undefined, authorId: string | null | undefined): boolean {
  return Boolean(authorId && blocked?.has(authorId));
}

// ---------------------------------------------------------------------------
// The word filter
// ---------------------------------------------------------------------------

/**
 * Words a post, reply or message may not contain.
 *
 * Deliberately short: slurs and the strongest profanity, matched as whole words
 * so "Scunthorpe" and "spice" pass. It is a floor, not a moderator; reports and
 * the dashboard queue do the real work. The same list is compiled into
 * `firestore.rules` (see `BLOCKED_WORDS_RULES_PATTERN`), so a client that skips
 * the app's check is refused by the server, and a test fails if the two drift.
 */
export const BLOCKED_WORDS = [
  "fuck",
  "fucking",
  "fucked",
  "fucker",
  "motherfucker",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "fag",
  "retard",
  "kike",
  "spic",
  "chink",
  "tranny",
  "whore",
  "slut",
] as const;

const WORDS_RE = new RegExp(`\\b(${BLOCKED_WORDS.join("|")})\\b`, "i");

/** The first blocked word in `text`, or null. Case-insensitive, whole words. */
export function findBlockedWord(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = WORDS_RE.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/** True when every given field is free of blocked words. */
export function passesWordFilter(...texts: (string | null | undefined)[]): boolean {
  return texts.every((t) => findBlockedWord(t) === null);
}

/** What the app says when the filter stops a post. */
export const WORD_FILTER_MESSAGE = "This contains a word that isn't allowed here. Please reword it.";

/**
 * The regex as it appears in `firestore.rules`, inside a single-quoted string.
 *
 * The rules language matches a whole string, so the pattern is wrapped in
 * `.*`, with `(?s)` so a line break does not end the match, and run on the
 * lowercased text. Backslashes are doubled for the rules string literal.
 */
export const BLOCKED_WORDS_RULES_PATTERN = `(?s).*\\\\b(${BLOCKED_WORDS.join("|")})\\\\b.*`;
