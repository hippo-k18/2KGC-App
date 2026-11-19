import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';
import { isReviewToken, newReviewToken, REVIEW_LINK_TTL_MS, reviewLinkState } from './review-link';

const NOW = Date.UTC(2026, 10, 19, 12);
const token = newReviewToken();
const link = (over: Partial<{ postId: string; expiresAt: number }> = {}) => ({
  postId: 'p1',
  expiresAt: NOW + REVIEW_LINK_TTL_MS,
  ...over,
});
const post = (over: Partial<{ reviewLinkId?: string; draftState: 'none' | 'editing' | 'review' | 'changes' }> = {}) => ({
  reviewLinkId: token,
  draftState: 'editing' as const,
  ...over,
});

describe('a review link shows the draft', () => {
  it('while it exists, has not expired and the post still points at it', () => {
    expect(reviewLinkState(token, link(), post(), NOW)).toBe('ok');
    expect(reviewLinkState(token, link(), post({ draftState: 'review' }), NOW)).toBe('ok');
  });
});

/** Every state but `ok` is rendered as the same 404 by the shared page. */
describe('a review link is a 404', () => {
  it('once revoked: the link document is gone', () => {
    expect(reviewLinkState(token, null, post({ reviewLinkId: undefined }), NOW)).toBe('missing');
  });

  it('once replaced, even if the old document were left behind', () => {
    expect(reviewLinkState(token, link(), post({ reviewLinkId: newReviewToken() }), NOW)).toBe('superseded');
  });

  it('once expired, from the exact expiry instant', () => {
    expect(reviewLinkState(token, link({ expiresAt: NOW }), post(), NOW)).toBe('expired');
    expect(reviewLinkState(token, link({ expiresAt: NOW - 1 }), post(), NOW)).toBe('expired');
    expect(reviewLinkState(token, link({ expiresAt: NOW + 1 }), post(), NOW)).toBe('ok');
  });

  it('once the post is deleted', () => {
    expect(reviewLinkState(token, link(), null, NOW)).toBe('no-post');
  });

  it('once the post is published, even if the link survived the publish', () => {
    // Publishing deletes the link and clears `reviewLinkId`; this is the
    // second line, for a link document left behind by a failed write.
    expect(reviewLinkState(token, link(), post({ draftState: 'none' }), NOW)).toBe('nothing-to-review');
    expect(reviewLinkState(token, null, post({ draftState: 'none', reviewLinkId: undefined }), NOW)).toBe('missing');
  });

  it('lasts thirty days', () => {
    expect(REVIEW_LINK_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('review tokens', () => {
  it('are 256 random bits, and anything else never reaches Firestore', () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newReviewToken()).not.toBe(token);
    expect(isReviewToken(token)).toBe(true);
    expect(isReviewToken(token.slice(1))).toBe(false);
    expect(isReviewToken(`${token.slice(1)}/`)).toBe(false);
    expect(isReviewToken('../blogPosts/x')).toBe(false);
  });
});

describe('the shared page’s headers', () => {
  /** What a path ends up with: Next applies every matching entry in order, last one wins. */
  async function headersFor(path: string): Promise<Record<string, string>> {
    const entries = (await nextConfig.headers?.()) ?? [];
    const out: Record<string, string> = {};
    for (const entry of entries) {
      const pattern = new RegExp(
        `^${entry.source.replace(/:[a-z]+\*/gi, '.*').replace(/:[a-z]+/gi, '[^/]+')}$`,
        'i',
      );
      if (pattern.test(path)) for (const h of entry.headers) out[h.key.toLowerCase()] = h.value;
    }
    return out;
  }

  for (const path of [`/blog/shared/${token}`, `/shared/${token}`]) {
    it(`keep ${path.replace(token, '{token}')} out of indexes, caches and referrers`, async () => {
      const h = await headersFor(path);
      expect(h['x-robots-tag']).toMatch(/noindex/);
      expect(h['cache-control']).toMatch(/no-store/);
      expect(h['referrer-policy']).toBe('no-referrer');
    });
  }

  it('leave the rest of the blog alone', async () => {
    const h = await headersFor('/blog/some-post');
    expect(h['x-robots-tag']).toBeUndefined();
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});
