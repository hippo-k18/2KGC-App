/**
 * Review links end when the draft they show stops being a draft to review.
 *
 * `review-link.test.ts` covers the resolver, which refuses a link whose post
 * has nothing unpublished. These tests cover the other half: that publishing,
 * unpublishing, discarding and deleting really delete the link document and
 * clear `reviewLinkId`, so nothing is left for a later edit to bring back to
 * life. They run the real store against the emulator.
 *
 * Run with: npm run test:blog
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { COLLECTIONS } from '@kgc/shared';

// `next/cache` is aliased to a stub in `vitest.blog.mts`.
// Publishing tells the writer by email. Nothing here should try to send one.
vi.mock('@kgc/scripts/src/lib/email', () => ({
  sendBlogReviewDecision: async () => {},
  sendBlogReviewRequest: async () => {},
}));

import { db } from '@/lib/firestore';
import type { Viewer } from '@/lib/blog/access';
import type { BlogPostDoc, PostFields } from '@/lib/blog/types';
import {
  createReviewLink,
  deletePost,
  discardDraft,
  findSharedDraft,
  publish,
  revokeReviewLink,
  unpublish,
} from '@/lib/blog/store';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'FIRESTORE_EMULATOR_HOST is not set. These tests write real documents and must ' +
        'never run against the live project. Use: npm run test:blog',
    );
  }
});

const writer: Viewer = { email: 'writer@example.test', name: 'Writer', role: 'writer' };
const other: Viewer = { email: 'other@example.test', name: 'Other', role: 'writer' };
const editor: Viewer = { email: 'editor@example.test', name: 'Editor', role: 'editor' };

const posts = () => db().collection(COLLECTIONS.blogPosts);
const links = () => db().collection(COLLECTIONS.blogReviewLinks);

function fields(slug: string, text: string): PostFields {
  return {
    title: `Post ${slug}`,
    slug,
    excerpt: '',
    date: '',
    authorName: 'Writer',
    categories: [],
    tags: [],
    cover: null,
    body: { kind: 'doc', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } },
  };
}

/** A writer's post: a new draft, or a live post with edits beside it. */
async function seed(id: string, opts: { live?: boolean } = {}) {
  const now = new Date();
  const doc: BlogPostDoc = {
    authorEmail: writer.email,
    live: opts.live ? fields(id, 'Live text.') : null,
    draft: fields(id, 'Draft text.'),
    draftState: 'editing',
    everPublished: !!opts.live,
    createdAt: now,
    updatedAt: now,
    updatedBy: writer.email,
  };
  await posts().doc(id).set(doc);
}

const tokenOf = (url: string) => url.split('/shared/')[1];

/** The link is gone everywhere: no document, no field on the post, no page. */
async function expectEnded(id: string, token: string) {
  expect((await links().doc(token).get()).exists).toBe(false);
  const post = await posts().doc(id).get();
  if (post.exists) expect(post.data()).not.toHaveProperty('reviewLinkId');
  expect(await findSharedDraft(token)).toBeNull();
}

afterEach(async () => {
  for (const c of [posts(), links()]) {
    const snap = await c.get();
    await Promise.all(snap.docs.map((d) => db().recursiveDelete(d.ref)));
  }
});

describe('review links end with the draft', () => {
  it('a new link opens the draft', async () => {
    await seed('opens');
    const token = tokenOf((await createReviewLink(writer, 'opens')).url);
    expect((await findSharedDraft(token))?.id).toBe('opens');
  });

  it('publishing removes the link', async () => {
    await seed('published');
    const token = tokenOf((await createReviewLink(writer, 'published')).url);
    await publish(editor, 'published');
    await expectEnded('published', token);
  });

  it('unpublishing removes the link, although the post is a draft again', async () => {
    await seed('unpublished', { live: true });
    const token = tokenOf((await createReviewLink(writer, 'unpublished')).url);
    await unpublish(editor, 'unpublished');
    await expectEnded('unpublished', token);
    // The draft is still there to share again, with a new link.
    const again = tokenOf((await createReviewLink(writer, 'unpublished')).url);
    expect(again).not.toBe(token);
    expect((await findSharedDraft(again))?.id).toBe('unpublished');
  });

  it('discarding the unpublished edits removes the link', async () => {
    await seed('discarded', { live: true });
    const token = tokenOf((await createReviewLink(writer, 'discarded')).url);
    await discardDraft(writer, 'discarded');
    await expectEnded('discarded', token);
  });

  it('deleting the post removes the link', async () => {
    await seed('deleted');
    const token = tokenOf((await createReviewLink(writer, 'deleted')).url);
    await deletePost(writer, 'deleted');
    await expectEnded('deleted', token);
  });

  it('turning the link off removes it', async () => {
    await seed('revoked');
    const token = tokenOf((await createReviewLink(writer, 'revoked')).url);
    await revokeReviewLink(writer, 'revoked');
    await expectEnded('revoked', token);
  });

  it('replacing the link ends the old one', async () => {
    await seed('replaced');
    const first = tokenOf((await createReviewLink(writer, 'replaced')).url);
    const second = tokenOf((await createReviewLink(writer, 'replaced')).url);
    expect((await links().doc(first).get()).exists).toBe(false);
    expect(await findSharedDraft(first)).toBeNull();
    expect((await findSharedDraft(second))?.id).toBe('replaced');
  });
});

describe('who can make or end a link', () => {
  it('another writer can neither create nor revoke one, and learns nothing from the error', async () => {
    await seed('theirs');
    const token = tokenOf((await createReviewLink(writer, 'theirs')).url);
    await expect(createReviewLink(other, 'theirs')).rejects.toThrow('There is no unpublished draft to share.');
    await expect(createReviewLink(other, 'no-such-post')).rejects.toThrow('There is no unpublished draft to share.');
    await expect(revokeReviewLink(other, 'theirs')).rejects.toThrow();
    expect((await findSharedDraft(token))?.id).toBe('theirs');
  });

  it('an editor can turn off a writer’s link', async () => {
    await seed('by-editor');
    const token = tokenOf((await createReviewLink(writer, 'by-editor')).url);
    await revokeReviewLink(editor, 'by-editor');
    await expectEnded('by-editor', token);
  });
});
