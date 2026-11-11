import 'server-only';

import { randomBytes } from 'node:crypto';
import { cache } from 'react';
import { revalidateTag } from 'next/cache';
import { COLLECTIONS } from '@kgc/shared';
import { sendBlogReviewDecision, sendBlogReviewRequest } from '@kgc/scripts/src/lib/email';
import { db } from '@/lib/firestore';
import { POSTS, type Post } from '@/lib/posts';
import * as rules from './access';
import type { PostAccessFacts, Viewer } from './access';
import { envEditors } from './auth';
import { isEmptyDoc, sanitizeDoc, type Doc } from './doc';
import { blogUrl } from './paths';
import {
  isValidSlug,
  slugify,
  type BlogMemberDoc,
  type BlogPostDoc,
  type Cover,
  type PostFields,
  type StoredPost,
} from './types';

/**
 * Every read and write of `blogPosts`, with the access rules applied.
 *
 * Each write reads the post inside a transaction, asks `access.ts` whether this
 * viewer may do this to the post as it now stands, and only then writes. The
 * browser supplies content and an id, never a status, an owner or a role.
 */

export const BLOG_TAG = 'blog';

const posts = () => db().collection(COLLECTIONS.blogPosts);
const membersCol = () => db().collection(COLLECTIONS.blogMembers);

const ms = (t: unknown): number | undefined => {
  const v = t as { toMillis?: () => number } | undefined;
  return typeof v?.toMillis === 'function' ? v.toMillis() : undefined;
};

function toStored(id: string, d: BlogPostDoc): StoredPost {
  return {
    ...d,
    id,
    submittedAt: ms(d.submittedAt),
    publishedAt: ms(d.publishedAt),
    createdAt: ms(d.createdAt) ?? 0,
    updatedAt: ms(d.updatedAt) ?? 0,
  };
}

export const facts = (p: Pick<StoredPost, 'authorEmail' | 'live' | 'everPublished' | 'draftState'>): PostAccessFacts => ({
  authorEmail: p.authorEmail,
  isLive: p.live !== null,
  everPublished: p.everPublished,
  draftState: p.draftState,
});

/** Every stored post. The collection is small; one read per request. */
export const allStoredPosts = cache(async (): Promise<StoredPost[]> => {
  const snap = await posts().get();
  return snap.docs.map((d) => toStored(d.id, d.data() as BlogPostDoc));
});

export const allMembers = cache(async (): Promise<BlogMemberDoc[]> => {
  const snap = await membersCol().get();
  return snap.docs.map((d) => d.data() as BlogMemberDoc);
});

// ── The archive ─────────────────────────────────────────────────────────────

export const legacyId = (slug: string) => `archive-${slug}`;

export function legacyFields(post: Post): PostFields {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerptIsQuote ? '' : post.excerpt,
    date: post.date,
    authorName: post.author,
    categories: post.categories,
    tags: post.tags,
    cover: post.image ? { src: post.image, width: post.imageWidth, height: post.imageHeight } : null,
    body: { kind: 'legacy', slug: post.slug },
  };
}

/** An archive post that has never been edited, shaped as if it had been stored. */
function unsavedArchive(post: Post): StoredPost {
  const fields = legacyFields(post);
  return {
    id: legacyId(post.slug),
    authorEmail: null,
    legacySlug: post.slug,
    live: fields,
    draft: fields,
    draftState: 'none',
    everPublished: true,
    createdAt: 0,
    updatedAt: 0,
    updatedBy: '',
  };
}

/** A post by id, including archive posts nobody has touched yet. */
export async function findPost(id: string): Promise<StoredPost | null> {
  const snap = await posts().doc(id).get();
  if (snap.exists) return toStored(id, snap.data() as BlogPostDoc);
  if (id.startsWith('archive-')) {
    const post = POSTS.find((p) => legacyId(p.slug) === id);
    if (post) return unsavedArchive(post);
  }
  return null;
}

/** Everything an editor's list shows: stored posts, plus the archive posts not yet stored. */
export async function studioPosts(viewer: Viewer): Promise<StoredPost[]> {
  const stored = await allStoredPosts();
  const storedLegacy = new Set(stored.map((p) => p.legacySlug).filter(Boolean));
  const archive = rules.isEditor(viewer)
    ? POSTS.filter((p) => !storedLegacy.has(p.slug)).map(unsavedArchive)
    : [];
  return [...stored, ...archive].filter((p) => rules.canView(viewer, facts(p)));
}

// ── Validation ──────────────────────────────────────────────────────────────

export class BlogError extends Error {}

export interface DraftInput {
  title: string;
  slug: string;
  excerpt: string;
  date: string;
  authorName?: string;
  categories: string[];
  tags: string[];
  cover: Cover | null;
  /** The editor's JSON. Absent when the body was not touched and is still the archive HTML. */
  doc?: unknown;
}

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function cleanList(raw: unknown, maxItems: number): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const v = clean(item, 60);
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out.slice(0, maxItems);
}

function cleanCover(raw: unknown): Cover | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const src = typeof c.src === 'string' ? c.src : '';
  // Uploaded images and the archive's own. Nothing hot-linked.
  if (!/^\/(blog-media|kgc\/blog)\/[A-Za-z0-9._/-]+$/.test(src) || src.includes('..')) return null;
  const width = Number(c.width);
  const height = Number(c.height);
  if (!(width > 0 && width < 20000 && height > 0 && height < 20000)) return null;
  return { src, width: Math.round(width), height: Math.round(height) };
}

/** Would this slug collide with another post, live, drafted or retired? */
async function slugTaken(slug: string, selfId: string): Promise<boolean> {
  const stored = await allStoredPosts();
  const self = stored.find((p) => p.id === selfId);
  for (const p of stored) {
    if (p.id === selfId) continue;
    if (p.draft.slug === slug || p.live?.slug === slug || p.previousSlugs?.includes(slug)) return true;
  }
  const storedLegacy = new Set(stored.map((p) => p.legacySlug));
  return POSTS.some(
    (p) => p.slug === slug && !storedLegacy.has(p.slug) && legacyId(p.slug) !== selfId && self?.legacySlug !== slug,
  );
}

// ── Writes ──────────────────────────────────────────────────────────────────

function touched(viewer: Viewer) {
  return { updatedAt: new Date(), updatedBy: viewer.email };
}

export async function createPost(viewer: Viewer): Promise<string> {
  const id = randomBytes(10).toString('base64url').replace(/[-_]/g, 'x');
  const now = new Date();
  const draft: PostFields = {
    title: '',
    slug: '',
    excerpt: '',
    date: '',
    authorName: viewer.name,
    categories: [],
    tags: [],
    cover: null,
    body: { kind: 'doc', doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
  };
  const doc: BlogPostDoc = {
    authorEmail: viewer.email,
    live: null,
    draft,
    draftState: 'editing',
    everPublished: false,
    createdAt: now,
    updatedAt: now,
    updatedBy: viewer.email,
  };
  await posts().doc(id).set(doc);
  return id;
}

/** Load a post for a write, materialising an archive post the first time it is touched. */
async function loadForWrite(
  tx: FirebaseFirestore.Transaction,
  id: string,
): Promise<{ ref: FirebaseFirestore.DocumentReference; post: StoredPost; exists: boolean }> {
  const ref = posts().doc(id);
  const snap = await tx.get(ref);
  if (snap.exists) return { ref, post: toStored(id, snap.data() as BlogPostDoc), exists: true };
  const archive = POSTS.find((p) => legacyId(p.slug) === id);
  if (!archive) throw new BlogError('That post no longer exists.');
  return { ref, post: unsavedArchive(archive), exists: false };
}

function stripId(post: StoredPost): BlogPostDoc {
  const { id: _id, submittedAt, publishedAt, createdAt, updatedAt, ...rest } = post;
  return {
    ...rest,
    ...(submittedAt ? { submittedAt: new Date(submittedAt) } : {}),
    ...(publishedAt ? { publishedAt: new Date(publishedAt) } : {}),
    createdAt: createdAt ? new Date(createdAt) : new Date(),
    updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
  };
}

export async function saveDraft(viewer: Viewer, id: string, input: DraftInput): Promise<{ savedAt: number; slug: string }> {
  const title = clean(input.title, 200);
  const wantSlug = clean(input.slug, 100).toLowerCase();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : '';

  // Checked outside the transaction: it reads the whole collection.
  const current = await findPost(id);
  if (!current) throw new BlogError('That post no longer exists.');
  let slug = current.draft.slug;
  if (rules.canChangeSlug(viewer, facts(current))) {
    const proposed = wantSlug || (current.everPublished ? current.draft.slug : slugify(title));
    if (proposed && proposed !== current.draft.slug) {
      if (!isValidSlug(proposed)) throw new BlogError('The web address can use lower-case letters, numbers and hyphens.');
      if (await slugTaken(proposed, id)) throw new BlogError(`Another post already uses /${proposed}.`);
    }
    slug = proposed;
  }

  const savedAt = Date.now();
  await db().runTransaction(async (tx) => {
    const { ref, post, exists } = await loadForWrite(tx, id);
    if (!rules.canEdit(viewer, facts(post))) {
      throw new BlogError(
        post.draftState === 'review' ? 'This post is waiting for review. Withdraw it to make changes.' : 'You cannot edit this post.',
      );
    }
    const body: PostFields['body'] =
      input.doc === undefined ? post.draft.body : { kind: 'doc', doc: sanitizeDoc(input.doc) };
    const draft: PostFields = {
      title,
      slug,
      excerpt: clean(input.excerpt, 400),
      date,
      authorName: rules.isEditor(viewer) ? clean(input.authorName, 120) || post.draft.authorName : post.draft.authorName,
      categories: cleanList(input.categories, 8),
      tags: cleanList(input.tags, 20),
      cover: input.cover === null ? null : cleanCover(input.cover),
      body,
    };
    const next: StoredPost = {
      ...post,
      draft,
      draftState: post.draftState === 'none' ? 'editing' : post.draftState,
      updatedAt: savedAt,
      updatedBy: viewer.email,
    };
    tx.set(ref, stripId(exists ? next : { ...next, createdAt: savedAt }));
  });
  return { savedAt, slug };
}

function assertPublishable(fields: PostFields) {
  if (!fields.title) throw new BlogError('Give the post a title first.');
  if (!fields.slug) throw new BlogError('Give the post a web address first.');
  if (fields.body.kind === 'doc' && isEmptyDoc(fields.body.doc)) throw new BlogError('The post has no text yet.');
}

async function editorAddresses(except: string): Promise<{ email: string; name: string }[]> {
  const members = await allMembers();
  const out = new Map<string, string>();
  for (const m of members) if (m.role === 'editor' && m.status !== 'removed') out.set(m.email, m.name);
  for (const e of envEditors()) if (!out.has(e)) out.set(e, e);
  out.delete(except);
  return [...out].map(([email, name]) => ({ email, name }));
}

export async function submitForReview(viewer: Viewer, id: string): Promise<void> {
  let title = '';
  let isEdit = false;
  await db().runTransaction(async (tx) => {
    const { ref, post } = await loadForWrite(tx, id);
    if (!rules.canSubmit(viewer, facts(post))) throw new BlogError('This post cannot be submitted right now.');
    assertPublishable(post.draft);
    title = post.draft.title;
    isEdit = post.live !== null;
    tx.update(ref, { draftState: 'review', submittedAt: new Date(), reviewNote: null, reviewNoteBy: null, ...touched(viewer) });
  });
  const link = blogUrl(`/write/${id}`);
  await Promise.all(
    (await editorAddresses(viewer.email)).map((e) =>
      sendBlogReviewRequest(db(), { to: e.email, authorName: viewer.name, title, link, isEdit }),
    ),
  );
}

export async function withdraw(viewer: Viewer, id: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const { ref, post } = await loadForWrite(tx, id);
    if (!rules.canWithdraw(viewer, facts(post))) throw new BlogError('This post is not waiting for review.');
    tx.update(ref, { draftState: 'editing', ...touched(viewer) });
  });
}

export async function publish(viewer: Viewer, id: string): Promise<{ slug: string }> {
  if (!rules.canPublish(viewer)) throw new BlogError('Only an editor can publish.');
  const current = await findPost(id);
  if (!current) throw new BlogError('That post no longer exists.');
  if (current.draft.slug !== current.live?.slug && (await slugTaken(current.draft.slug, id))) {
    throw new BlogError(`Another post already uses /${current.draft.slug}.`);
  }

  let notify: { email: string; title: string; slug: string } | null = null;
  let slug = '';
  await db().runTransaction(async (tx) => {
    const { ref, post, exists } = await loadForWrite(tx, id);
    assertPublishable(post.draft);
    const today = new Date().toISOString().slice(0, 10);
    const live: PostFields = { ...post.draft, date: post.draft.date || today };
    const previousSlugs = new Set(post.previousSlugs ?? []);
    if (post.live && post.live.slug !== live.slug) previousSlugs.add(post.live.slug);
    if (post.legacySlug && post.legacySlug !== live.slug) previousSlugs.add(post.legacySlug);
    previousSlugs.delete(live.slug);
    const now = Date.now();
    const next: StoredPost = {
      ...post,
      live,
      draft: live,
      draftState: 'none',
      everPublished: true,
      previousSlugs: [...previousSlugs],
      reviewNote: undefined,
      reviewNoteBy: undefined,
      publishedAt: now,
      updatedAt: now,
      updatedBy: viewer.email,
      createdAt: exists ? post.createdAt : now,
    };
    tx.set(ref, stripId(next));
    tx.create(ref.collection('revisions').doc(), { fields: live, at: new Date(), by: viewer.email, action: 'published' });
    slug = live.slug;
    if (post.authorEmail && post.authorEmail !== viewer.email) {
      notify = { email: post.authorEmail, title: live.title, slug: live.slug };
    }
  });
  revalidateTag(BLOG_TAG);
  const n = notify as { email: string; title: string; slug: string } | null;
  if (n) {
    const member = (await allMembers()).find((m) => m.email === n.email);
    await sendBlogReviewDecision(db(), {
      to: n.email,
      name: member?.name,
      title: n.title,
      decision: 'published',
      link: blogUrl(`/${n.slug}`),
      actor: viewer.email,
    });
  }
  return { slug };
}

export async function requestChanges(viewer: Viewer, id: string, rawNote: string): Promise<void> {
  const note = rawNote.trim().slice(0, 4000);
  let target: { email: string; title: string } | null = null;
  await db().runTransaction(async (tx) => {
    const { ref, post } = await loadForWrite(tx, id);
    if (!rules.canRequestChanges(viewer, facts(post))) throw new BlogError('This post is not waiting for review.');
    tx.update(ref, { draftState: 'changes', reviewNote: note || null, reviewNoteBy: viewer.name, ...touched(viewer) });
    if (post.authorEmail) target = { email: post.authorEmail, title: post.draft.title };
  });
  const t = target as { email: string; title: string } | null;
  if (t) {
    const member = (await allMembers()).find((m) => m.email === t.email);
    await sendBlogReviewDecision(db(), {
      to: t.email,
      name: member?.name,
      title: t.title,
      decision: 'changes-requested',
      note: note || undefined,
      link: blogUrl(`/write/${id}`),
      actor: viewer.email,
    });
  }
}

export async function unpublish(viewer: Viewer, id: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const { ref, post, exists } = await loadForWrite(tx, id);
    if (!rules.canUnpublish(viewer, facts(post))) throw new BlogError('This post is not published.');
    const now = Date.now();
    tx.set(
      ref,
      stripId({
        ...post,
        live: null,
        draftState: post.draftState === 'none' ? 'editing' : post.draftState,
        updatedAt: now,
        updatedBy: viewer.email,
        createdAt: exists ? post.createdAt : now,
      }),
    );
    tx.create(ref.collection('revisions').doc(), { fields: post.live, at: new Date(), by: viewer.email, action: 'unpublished' });
  });
  revalidateTag(BLOG_TAG);
}

export async function discardDraft(viewer: Viewer, id: string): Promise<void> {
  await db().runTransaction(async (tx) => {
    const { ref, post } = await loadForWrite(tx, id);
    if (!rules.canDiscardDraft(viewer, facts(post)) || !post.live) throw new BlogError('There are no edits to discard.');
    tx.update(ref, { draft: post.live, draftState: 'none', reviewNote: null, reviewNoteBy: null, ...touched(viewer) });
  });
}

export async function deletePost(viewer: Viewer, id: string): Promise<void> {
  const post = await findPost(id);
  if (!post) return;
  if (post.legacySlug) throw new BlogError('Archive posts cannot be deleted. Unpublish it instead.');
  if (!rules.canDelete(viewer, facts(post))) throw new BlogError('You cannot delete this post.');
  const revisions = await posts().doc(id).collection('revisions').listDocuments();
  const batch = db().batch();
  revisions.forEach((r) => batch.delete(r));
  batch.delete(posts().doc(id));
  await batch.commit();
  revalidateTag(BLOG_TAG);
}

export type { Doc };
