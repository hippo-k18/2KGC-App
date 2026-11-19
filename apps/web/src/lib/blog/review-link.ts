import { randomBytes } from 'node:crypto';
import type { DraftState } from './access';

/**
 * Review links: a private address that shows one post's draft, read-only, to
 * somebody without an editor account — a speaker checking a quote, a sponsor
 * approving a mention.
 *
 * ── What holding the link lets you do ──────────────────────────────────────
 *
 * Read that one post's current draft. Nothing else: the page has no action on
 * it, and the token names no person and no other post.
 *
 * ── Why a random token stored in Firestore, not a signed one ──────────────
 *
 * The link has to be revocable one at a time, and a signed token cannot be
 * revoked without keeping state anyway. So the token is 32 random bytes and is
 * the id of a `blogReviewLinks` document: opening the link is one `get`, and
 * revoking it is one delete, effective on the next request. It is stored as is,
 * not hashed, so the editor can show the link again. That costs nothing: the
 * collection is server-only, and anyone who can read it can read the draft
 * itself.
 *
 * ── When it stops working ──────────────────────────────────────────────────
 *
 * Turned off, replaced by a new link, expired (30 days), or the post published,
 * unpublished, discarded back to its live version, or deleted. Each of those
 * four post changes deletes the link, and the page also refuses a post with
 * nothing unpublished, so a link left behind shows nothing. Every one of those
 * is the same 404, so a dead link does not say it ever existed.
 *
 * Unpublishing ends it too, although the post becomes a draft again: taking a
 * post down is often urgent, and it should take every copy down at once. The
 * writer can make a new link afterwards.
 *
 * ⚠️ The accepted threat: the link is a bearer credential. Forward the email
 * and you forward the draft. Revocation and expiry bound it; nothing detects it.
 * It is tied to the post, not to the person who made it: removing a writer
 * from the blog leaves their links working until they expire, unless an editor
 * turns them off.
 *
 * Pure apart from `randomBytes`, so the rules below are tested without a
 * database, and `next.config.ts` can import the header list.
 */

export const REVIEW_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 32 random bytes as base64url: 43 characters, 256 bits, never guessed. */
export const newReviewToken = (): string => randomBytes(32).toString('base64url');

/** Checked before the token reaches Firestore, where a `/` would be a path. */
export const isReviewToken = (raw: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(raw);

export type ReviewLinkState =
  | 'ok'
  /** No such link: never created, revoked, or replaced. */
  | 'missing'
  | 'expired'
  /** The post was deleted. */
  | 'no-post'
  /** The post no longer points at this link — replaced, or revoked half-way. */
  | 'superseded'
  /** Published, or its edits discarded: there is no unpublished draft to show. */
  | 'nothing-to-review';

/**
 * Whether a link may show its post's draft. Every answer but `ok` is a 404.
 *
 * The post is checked as well as the link, so the post is the authority: a
 * link document left behind by a failed delete still cannot show anything.
 */
export function reviewLinkState(
  token: string,
  link: { postId: string; expiresAt: number } | null,
  post: { reviewLinkId?: string; draftState: DraftState } | null,
  now: number,
): ReviewLinkState {
  if (!link) return 'missing';
  if (link.expiresAt <= now) return 'expired';
  if (!post) return 'no-post';
  if (post.reviewLinkId !== token) return 'superseded';
  if (post.draftState === 'none') return 'nothing-to-review';
  return 'ok';
}

/**
 * Response headers for the shared page, on both of the paths it is served at:
 * `/blog/shared/…` on the main site and `/shared/…` on the blog host, where
 * Next matches headers before the rewrite. Listed after the site-wide headers
 * in `next.config.ts`, because the last match wins.
 *
 * The site-wide `strict-origin-when-cross-origin` already keeps the path, and
 * so the token, off links to other sites. `no-referrer` goes further and sends
 * nothing at all, so a link in an unannounced draft does not even tell the
 * other site that somebody came from this blog.
 */
export const REVIEW_LINK_HEADERS = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
  { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
];

export const REVIEW_LINK_SOURCES = ['/blog/shared/:token', '/shared/:token'];
