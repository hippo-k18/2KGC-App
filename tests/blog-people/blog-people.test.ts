/**
 * Managing who writes for the blog from the blog itself (T199), and that it is
 * the same list the dashboard manages. Real code from both apps against the
 * Firestore emulator; Resend is replaced by a stub that records each request.
 *
 * Run with: npm run test:blog-people
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** The signed-in blog user for the server actions. Set per test. */
const signedIn = vi.hoisted(() => ({ viewer: null as null | { email: string; name: string; role: 'editor' | 'writer' } }));
vi.mock('../../apps/web/src/lib/blog/auth.ts', () => ({
  currentViewer: async () => (signedIn.viewer ? { ...signedIn.viewer, member: {} } : null),
  requestCode: async () => ({ ok: false, error: 'unused' }),
  verifyCode: async () => ({ ok: false, error: 'unused' }),
  signOut: async () => {},
  envEditors: () => ['owner@example.com'],
}));
vi.mock('../../apps/web/node_modules/next/cache.js', () => ({ revalidateTag: () => {}, revalidatePath: () => {} }));
vi.mock('../../apps/organizer/node_modules/next/cache.js', () => ({ revalidatePath: () => {} }));

import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type BlogMemberDoc } from '@kgc/shared';
import { db as webDb } from '../../apps/web/src/lib/firestore';
import * as blog from '../../apps/web/src/lib/blog/people';
import * as actions from '../../apps/web/src/app/blog/write/actions';
import * as dash from '../../apps/organizer/src/lib/blog-access';

let db: Firestore;
const sent: { to: string; subject: string; text: string }[] = [];
const realFetch = globalThis.fetch;

const EDITOR = { email: 'ed@example.com', name: 'Ed Itor', role: 'editor' as const };
const WRITER = { email: 'wri@example.com', name: 'Wri Ter', role: 'writer' as const };
const OWNER = 'owner@example.com';

async function wipe(collection: string) {
  const snap = await db.collection(collection).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

async function member(email: string, role: 'editor' | 'writer', status: BlogMemberDoc['status'] = 'active') {
  await db.collection(COLLECTIONS.blogMembers).doc(email).set({
    email,
    name: email.split('@')[0],
    role,
    status,
    sessionEpoch: 'e1',
  } satisfies BlogMemberDoc);
}

const doc = async (email: string) =>
  (await db.collection(COLLECTIONS.blogMembers).doc(email).get()).data() as BlogMemberDoc | undefined;
const audits = async () =>
  (await db.collection(COLLECTIONS.auditLog).get()).docs.map((d) => d.data() as Record<string, unknown>);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:blog-people');
  db = webDb() as unknown as Firestore;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://api.resend.com/')) {
      const body = JSON.parse(String(init?.body));
      sent.push({ to: [].concat(body.to)[0], subject: body.subject, text: body.text });
      return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 });
    }
    throw new Error(`Unexpected request in a test: ${String(url)}`);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(async () => {
  process.env.RESEND_API_KEY = 're_test_key';
  sent.length = 0;
  await Promise.all(
    [COLLECTIONS.blogMembers, COLLECTIONS.blogPosts, COLLECTIONS.auditLog, COLLECTIONS.emailLog].map(wipe),
  );
  await member(EDITOR.email, 'editor');
  await member(WRITER.email, 'writer');
  signedIn.viewer = EDITOR;
});

describe('an editor on the blog People page', () => {
  it('sees everyone, with role, status and post count, removed people included', async () => {
    await member('gone@example.com', 'writer', 'removed');
    await db.collection(COLLECTIONS.blogPosts).doc('p1').set({ authorEmail: WRITER.email });
    await db.collection(COLLECTIONS.blogPosts).doc('p2').set({ authorEmail: WRITER.email });
    const people = await blog.listPeople(EDITOR);
    expect(people.map((p) => [p.email, p.role, p.status, p.posts])).toEqual([
      ['ed@example.com', 'editor', 'active', 0],
      ['owner@example.com', 'editor', 'invited', 0],
      ['wri@example.com', 'writer', 'active', 2],
      ['gone@example.com', 'writer', 'removed', 0],
    ]);
    expect(people.find((p) => p.email === OWNER)?.fixed).toBe(true);
  });

  it('adds a guest writer, sends the invitation once, and audits it as the editor from the blog', async () => {
    const res = await actions.invitePersonAction({ email: ' Guest@Example.com ', name: 'Guest Writer', role: 'writer' });
    expect(res).toEqual({ ok: true, message: 'guest@example.com added as a writer. Their invitation is on its way.' });
    expect(await doc('guest@example.com')).toMatchObject({ name: 'Guest Writer', role: 'writer', status: 'invited', invitedBy: EDITOR.email });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'guest@example.com', subject: 'Write for the KGC blog' });
    expect(sent[0].text).toContain('https://www.example.test/blog/write/sign-in?email=guest%40example.com&invite=');
    expect(await audits()).toEqual([
      expect.objectContaining({ action: 'blog.invite', actor: EDITOR.email, source: 'blog', targetId: 'guest@example.com' }),
    ]);
  });

  it('resends an invitation, changes a role and removes someone', async () => {
    await actions.invitePersonAction({ email: 'g@example.com', name: 'G', role: 'writer' });
    sent.length = 0;
    expect((await actions.resendInvitationAction('g@example.com')).ok).toBe(true);
    expect(sent.map((s) => s.to)).toEqual(['g@example.com']);

    expect(await actions.setPersonRoleAction(WRITER.email, 'editor')).toEqual({ ok: true, message: 'wri is now an editor.' });
    expect((await doc(WRITER.email))?.role).toBe('editor');
    expect((await doc(WRITER.email))?.sessionEpoch).not.toBe('e1');

    expect((await actions.removePersonAction('g@example.com')).ok).toBe(true);
    expect((await doc('g@example.com'))?.status).toBe('removed');
    expect((await audits()).map((a) => [a.action, a.source])).toEqual(
      expect.arrayContaining([
        ['blog.resendInvitation', 'blog'],
        ['blog.role', 'blog'],
        ['blog.remove', 'blog'],
      ]),
    );
  });

  it('cannot remove or demote themselves', async () => {
    expect(await actions.removePersonAction(EDITOR.email)).toEqual({ ok: false, error: 'You cannot remove yourself. Ask another editor.' });
    expect(await actions.setPersonRoleAction(EDITOR.email, 'writer')).toEqual({
      ok: false,
      error: 'You cannot make yourself a writer. Ask another editor.',
    });
    expect((await doc(EDITOR.email))).toMatchObject({ role: 'editor', status: 'active' });
  });

  it('cannot change an editor named in BLOG_EDITORS', async () => {
    await member(OWNER, 'editor');
    expect((await actions.setPersonRoleAction(OWNER, 'writer')).ok).toBe(false);
    expect((await actions.removePersonAction(OWNER)).ok).toBe(false);
    expect((await doc(OWNER))?.status).toBe('active');
  });
});

describe('the last editor', () => {
  it('cannot be removed or made a writer when no other editor exists', async () => {
    const before = process.env.BLOG_EDITORS;
    process.env.BLOG_EDITORS = '';
    try {
      // Acting from the dashboard, which is the only way to reach the last editor
      // without being them.
      expect(await dash.removeBlogPerson({ email: EDITOR.email, actor: 'boss@example.com' })).toEqual({
        ok: false,
        error: 'ed is the only editor. Make someone else an editor first.',
      });
      expect((await dash.setBlogRole({ email: EDITOR.email, role: 'writer', actor: 'boss@example.com' })).ok).toBe(false);
      expect(await doc(EDITOR.email)).toMatchObject({ role: 'editor', status: 'active' });

      // With a second editor it goes through.
      await member('ed2@example.com', 'editor');
      expect((await dash.setBlogRole({ email: EDITOR.email, role: 'writer', actor: 'boss@example.com' })).ok).toBe(true);
    } finally {
      process.env.BLOG_EDITORS = before;
    }
  });

  it('counts BLOG_EDITORS as editors, so the list editor can be changed while one is set', async () => {
    expect((await dash.setBlogRole({ email: EDITOR.email, role: 'writer', actor: OWNER })).ok).toBe(true);
  });
});

describe('a writer', () => {
  beforeEach(() => {
    signedIn.viewer = WRITER;
  });

  it('is refused by every People action, on the server', async () => {
    const refused = { ok: false, error: blog.NOT_AN_EDITOR };
    expect(await actions.invitePersonAction({ email: 'x@example.com', name: 'X', role: 'editor' })).toEqual(refused);
    expect(await actions.resendInvitationAction(EDITOR.email)).toEqual(refused);
    expect(await actions.setPersonRoleAction(WRITER.email, 'editor')).toEqual(refused);
    expect(await actions.removePersonAction(EDITOR.email)).toEqual(refused);
    await expect(blog.listPeople(WRITER)).rejects.toThrow(blog.NOT_AN_EDITOR);
    expect(await doc('x@example.com')).toBeUndefined();
    expect((await doc(WRITER.email))?.role).toBe('writer');
    expect(sent).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });

  it('is refused when signed out too', async () => {
    signedIn.viewer = null;
    expect((await actions.removePersonAction(WRITER.email)).ok).toBe(false);
    expect((await doc(WRITER.email))?.status).toBe('active');
  });
});

describe('one list for both screens', () => {
  it('shows a change made on the blog on the dashboard, and the reverse', async () => {
    await actions.invitePersonAction({ email: 'from-blog@example.com', name: 'From Blog', role: 'writer' });
    expect((await dash.listBlogPeople()).map((p) => p.email)).toContain('from-blog@example.com');

    await dash.inviteBlogPerson({ email: 'from-dash@example.com', name: 'From Dash', role: 'editor', actor: 'boss@example.com' });
    const onBlog = await blog.listPeople(EDITOR);
    expect(onBlog.find((p) => p.email === 'from-dash@example.com')).toMatchObject({ role: 'editor', status: 'invited' });

    await dash.removeBlogPerson({ email: 'from-blog@example.com', actor: 'boss@example.com' });
    expect((await blog.listPeople(EDITOR)).find((p) => p.email === 'from-blog@example.com')?.status).toBe('removed');
    expect((await dash.listBlogPeople()).map((p) => p.email)).not.toContain('from-blog@example.com');

    await actions.setPersonRoleAction('from-dash@example.com', 'writer');
    expect((await dash.listBlogPeople()).find((p) => p.email === 'from-dash@example.com')?.role).toBe('writer');

    expect(sent.map((s) => s.to)).toEqual(['from-blog@example.com', 'from-dash@example.com']);
    const sources = (await audits()).map((a) => `${a.action}:${a.source}:${a.actor}`).sort();
    expect(sources).toEqual([
      'blog.invite:blog:ed@example.com',
      'blog.invite:dashboard:boss@example.com',
      'blog.remove:dashboard:boss@example.com',
      'blog.role:blog:ed@example.com',
    ]);
  });

  it('lets someone removed be added back, keeping their bio', async () => {
    await db.collection(COLLECTIONS.blogMembers).doc('back@example.com').set({
      email: 'back@example.com', name: 'Back', role: 'writer', status: 'removed', sessionEpoch: 'e', bio: 'Writes about graphs.',
    });
    expect((await actions.invitePersonAction({ email: 'back@example.com', name: 'Back Again', role: 'writer' })).ok).toBe(true);
    expect(await doc('back@example.com')).toMatchObject({ status: 'invited', name: 'Back Again', bio: 'Writes about graphs.' });
  });
});
