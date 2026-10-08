import { randomBytes } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, blogPublicOrigin, type BlogMemberDoc } from '@kgc/shared';
import { sendBlogInvitation } from './email.js';

/**
 * Who can write for the blog, and every change to that list.
 *
 * Two screens manage it: the dashboard's Attendees › Admin Settings › Blog,
 * and the blog editor's own People page (editors only). Both call these
 * functions with their own Firestore handle and the address of whoever is
 * acting, so the rules, the invitation email and the audit entry are the same
 * whichever screen was used, and a change on one shows on the other at once.
 *
 * The blog editor reads `blogMembers` on every request, so a removal or a role
 * change is felt on the person's next click. The addresses in `BLOG_EDITORS`
 * are editors whatever this list says and cannot be changed from either screen.
 *
 * No `FieldValue` here: this module resolves its own copy of firebase-admin,
 * and a sentinel from one copy is rejected by a Firestore from another.
 */

export type BlogRole = BlogMemberDoc['role'];
export type BlogSource = 'dashboard' | 'blog';

export interface BlogActor {
  email: string;
  /** Which screen the change came from. Recorded on the audit entry. */
  source: BlogSource;
}

export interface BlogPerson {
  email: string;
  name: string;
  role: BlogRole;
  status: BlogMemberDoc['status'];
  /** Named in BLOG_EDITORS on the server. */
  fixed: boolean;
  /** ISO, so a row can cross into a client component. */
  lastSignInAt: string | null;
  /** Posts they own, drafts included. */
  posts: number;
}

export type BlogResult = { ok: true; message: string } | { ok: false; error: string };

const members = (store: Firestore) => store.collection(COLLECTIONS.blogMembers);

export function fixedBlogEditors(): string[] {
  return (process.env.BLOG_EDITORS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
const nonce = () => randomBytes(24).toString('base64url');
const roleWords = (role: BlogRole) => (role === 'editor' ? 'an editor' : 'a writer');
const iso = (v: unknown) =>
  v && typeof (v as { toDate?: unknown }).toDate === 'function' ? (v as { toDate(): Date }).toDate().toISOString() : null;

/**
 * The blog editor's sign-in page, with the address filled in. With the token,
 * opening it marks them Active (`acceptBlogInvitation()` in the website);
 * getting in still takes an emailed code.
 */
export function blogSignInLink(email: string, inviteToken?: string): string {
  const params = new URLSearchParams({ email });
  if (inviteToken) params.set('invite', inviteToken);
  return `${blogPublicOrigin()}/write/sign-in?${params}`;
}

/** Where editors manage this list on the blog itself. */
export const blogPeopleUrl = () => `${blogPublicOrigin()}/write/people`;

async function audit(
  store: Firestore,
  actor: BlogActor,
  action: 'blog.invite' | 'blog.role' | 'blog.remove' | 'blog.resendInvitation',
  email: string,
  subject: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  try {
    await store.collection(COLLECTIONS.auditLog).add({
      eventId: EVENT_ID,
      actor: actor.email,
      source: actor.source,
      action,
      targetPath: `${COLLECTIONS.blogMembers}/${email}`,
      targetId: email,
      subject,
      before,
      after,
      at: new Date(),
    });
  } catch (err) {
    // The change itself went through. A lost audit line must not undo it.
    console.error(`[blog-people] audit ${action} failed`, err);
  }
}

/**
 * Everyone on the list, editors first. Removed people are included with
 * `includeRemoved`, so a screen can show who used to have access.
 */
export async function listBlogPeople(
  store: Firestore,
  opts: { includeRemoved?: boolean } = {},
): Promise<BlogPerson[]> {
  const fixed = fixedBlogEditors();
  const [snap, posts] = await Promise.all([members(store).get(), store.collection(COLLECTIONS.blogPosts).get()]);
  const count = new Map<string, number>();
  for (const p of posts.docs) {
    const a = p.get('authorEmail') as string | null | undefined;
    if (a) count.set(a, (count.get(a) ?? 0) + 1);
  }
  const people: BlogPerson[] = snap.docs
    .map((d) => d.data() as BlogMemberDoc)
    .filter((m) => opts.includeRemoved || m.status !== 'removed')
    .map((m) => ({
      email: m.email,
      name: m.name,
      role: fixed.includes(m.email) ? 'editor' : m.role,
      status: fixed.includes(m.email) && m.status === 'removed' ? 'active' : m.status,
      fixed: fixed.includes(m.email),
      lastSignInAt: iso(m.lastSignInAt),
      posts: count.get(m.email) ?? 0,
    }));
  for (const email of fixed) {
    if (!people.some((p) => p.email === email)) {
      people.push({ email, name: '', role: 'editor', status: 'invited', fixed: true, lastSignInAt: null, posts: count.get(email) ?? 0 });
    }
  }
  const rank = (p: BlogPerson) => (p.status === 'removed' ? 2 : p.role === 'editor' ? 0 : 1);
  return people.sort((a, b) => rank(a) - rank(b) || a.email.localeCompare(b.email));
}

/** Editors who could still sign in if `email` lost the role. */
async function otherEditors(store: Firestore, email: string): Promise<number> {
  const fixed = fixedBlogEditors();
  const snap = await members(store).where('role', '==', 'editor').get();
  const fromList = snap.docs
    .map((d) => d.data() as BlogMemberDoc)
    .filter((m) => m.status !== 'removed' && m.email !== email && !fixed.includes(m.email)).length;
  return fromList + fixed.filter((e) => e !== email).length;
}

async function current(store: Firestore, email: string): Promise<BlogMemberDoc | null> {
  const d = (await members(store).doc(email).get()).data() as BlogMemberDoc | undefined;
  return d && d.status !== 'removed' ? d : null;
}

export async function inviteBlogPerson(
  store: Firestore,
  input: { email: string; name: string; role: BlogRole },
  actor: BlogActor,
): Promise<BlogResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 120);
  const role: BlogRole = input.role === 'editor' ? 'editor' : 'writer';
  if (!looksLikeEmail(email) || email.includes('/')) return { ok: false, error: 'Enter an email address.' };
  if (!name) return { ok: false, error: 'Add their name. It is the byline on their posts.' };
  if (fixedBlogEditors().includes(email)) return { ok: false, error: `${email} is already an editor.` };

  const ref = members(store).doc(email);
  const before = (await ref.get()).data() as BlogMemberDoc | undefined;
  if (before && before.status !== 'removed') return { ok: false, error: `${email} can already sign in to the blog.` };

  const inviteToken = nonce();
  const doc: BlogMemberDoc = {
    email,
    name,
    role,
    status: 'invited',
    inviteToken,
    invitedBy: actor.email,
    invitedAt: new Date(),
    sessionEpoch: nonce(),
    // Someone coming back keeps the photo and bio they had.
    ...(before?.bio ? { bio: before.bio } : {}),
    ...(before?.avatar ? { avatar: before.avatar } : {}),
  };
  await ref.set(doc);
  const outcome = await sendBlogInvitation(store, {
    to: email,
    name,
    invitedBy: 'The KGC team',
    roleLabel: roleWords(role),
    link: blogSignInLink(email, inviteToken),
    actor: actor.email,
  });
  await audit(store, actor, 'blog.invite', email, name, {}, { email, role, emailed: outcome === 'sent' });
  return {
    ok: true,
    message:
      outcome === 'sent'
        ? `${email} added as ${roleWords(role)}. Their invitation is on its way.`
        : `${email} added as ${roleWords(role)}, but the email did not go out. Send them ${blogSignInLink(email)}.`,
  };
}

export async function setBlogRole(
  store: Firestore,
  input: { email: string; role: BlogRole },
  actor: BlogActor,
): Promise<BlogResult> {
  const email = input.email.trim().toLowerCase();
  const role: BlogRole = input.role === 'editor' ? 'editor' : 'writer';
  if (fixedBlogEditors().includes(email)) return { ok: false, error: 'That address is an editor in the server settings.' };
  const m = await current(store, email);
  if (!m) return { ok: false, error: 'They no longer have blog access.' };
  if (m.role === role) return { ok: true, message: `${m.name || email} is already ${roleWords(role)}.` };
  if (role === 'writer') {
    if (email === actor.email.toLowerCase()) return { ok: false, error: 'You cannot make yourself a writer. Ask another editor.' };
    if ((await otherEditors(store, email)) === 0) return { ok: false, error: `${m.name || email} is the only editor. Make someone else an editor first.` };
  }
  await members(store).doc(email).update({ role, sessionEpoch: nonce() });
  await audit(store, actor, 'blog.role', email, m.name, { role: m.role }, { role });
  return { ok: true, message: `${m.name || email} is now ${roleWords(role)}.` };
}

/** Ends blog access at once. Their posts stay, and editors can still publish or remove them. */
export async function removeBlogPerson(
  store: Firestore,
  input: { email: string },
  actor: BlogActor,
): Promise<BlogResult> {
  const email = input.email.trim().toLowerCase();
  if (fixedBlogEditors().includes(email)) return { ok: false, error: 'That address is an editor in the server settings.' };
  const m = await current(store, email);
  if (!m) return { ok: false, error: 'They already have no blog access.' };
  if (email === actor.email.toLowerCase()) return { ok: false, error: 'You cannot remove yourself. Ask another editor.' };
  if (m.role === 'editor' && (await otherEditors(store, email)) === 0) {
    return { ok: false, error: `${m.name || email} is the only editor. Make someone else an editor first.` };
  }
  await members(store).doc(email).update({ status: 'removed', sessionEpoch: nonce() });
  await audit(store, actor, 'blog.remove', email, m.name, { role: m.role, status: m.status }, { status: 'removed' });
  return { ok: true, message: `${m.name || email} can no longer sign in to the blog. Their posts stay.` };
}

export async function resendBlogInvitation(
  store: Firestore,
  input: { email: string },
  actor: BlogActor,
): Promise<BlogResult> {
  const email = input.email.trim().toLowerCase();
  const m = await current(store, email);
  if (!m) return { ok: false, error: 'They no longer have blog access.' };
  // Invitations sent before links carried a token get one now.
  let inviteToken = m.inviteToken;
  if (m.status === 'invited' && !inviteToken) {
    inviteToken = nonce();
    await members(store).doc(email).update({ inviteToken });
  }
  const outcome = await sendBlogInvitation(store, {
    to: email,
    name: m.name,
    invitedBy: 'The KGC team',
    roleLabel: roleWords(m.role),
    link: blogSignInLink(email, inviteToken),
    actor: actor.email,
  });
  await audit(store, actor, 'blog.resendInvitation', email, m.name, {}, { emailed: outcome === 'sent' });
  return outcome === 'sent'
    ? { ok: true, message: `Invitation sent again to ${email}.` }
    : { ok: false, error: `The email to ${email} did not go out. Send them ${blogSignInLink(email)}.` };
}
