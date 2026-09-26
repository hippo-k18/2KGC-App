import 'server-only';

import { Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, publicSiteOrigin, type BlogMemberDoc } from '@kgc/shared';
import { sendBlogInvitation } from '@kgc/scripts/src/lib/email';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';
import { looksLikeEmail, newNonce } from './team-core';

/**
 * Who can write for the blog at blog.knowledgegraph.tech, managed from
 * Attendees › Admin Settings.
 *
 * The blog editor (`apps/web/src/lib/blog/auth.ts`) reads `blogMembers` on
 * every request, so a removal or a role change here is felt on the person's
 * next click. The addresses in `BLOG_EDITORS` are editors whatever this list
 * says, so they are shown but cannot be changed from the screen.
 */

export type BlogRole = BlogMemberDoc['role'];

export interface BlogPerson {
  email: string;
  name: string;
  role: BlogRole;
  status: BlogMemberDoc['status'];
  /** Named in BLOG_EDITORS on the server. */
  fixed: boolean;
  /** ISO, so a row can cross into a client component. */
  lastSignInAt: string | null;
}

export type BlogResult = { ok: true; message: string } | { ok: false; error: string };

const col = () => db().collection(COLLECTIONS.blogMembers);

export function fixedBlogEditors(): string[] {
  return (process.env.BLOG_EDITORS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** The blog editor's sign-in page, with the address filled in. */
function signInLink(email: string): string {
  const origin = (process.env.BLOG_ORIGIN ?? `${publicSiteOrigin()}/blog`).replace(/\/$/, '');
  return `${origin}/write/sign-in?email=${encodeURIComponent(email)}`;
}

const roleWords = (role: BlogRole) => (role === 'editor' ? 'an editor' : 'a writer');

export async function listBlogPeople(): Promise<BlogPerson[]> {
  const fixed = fixedBlogEditors();
  const snap = await col().get();
  const people: BlogPerson[] = snap.docs
    .map((d) => d.data() as BlogMemberDoc)
    .filter((m) => m.status !== 'removed')
    .map((m) => ({
      email: m.email,
      name: m.name,
      role: fixed.includes(m.email) ? 'editor' : m.role,
      status: m.status,
      fixed: fixed.includes(m.email),
      lastSignInAt: m.lastSignInAt instanceof Timestamp ? m.lastSignInAt.toDate().toISOString() : null,
    }));
  for (const email of fixed) {
    if (!people.some((p) => p.email === email)) {
      people.push({ email, name: '', role: 'editor', status: 'invited', fixed: true, lastSignInAt: null });
    }
  }
  return people.sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'editor' ? -1 : 1));
}

export async function inviteBlogPerson(input: {
  email: string;
  name: string;
  role: BlogRole;
  actor: string;
}): Promise<BlogResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 120);
  const role: BlogRole = input.role === 'editor' ? 'editor' : 'writer';
  if (!looksLikeEmail(email) || email.includes('/')) return { ok: false, error: 'Enter an email address.' };
  if (!name) return { ok: false, error: 'Add their name. It is the byline on their posts.' };
  if (fixedBlogEditors().includes(email)) return { ok: false, error: `${email} is already an editor.` };

  try {
    const ref = col().doc(email);
    const before = (await ref.get()).data() as BlogMemberDoc | undefined;
    if (before && before.status !== 'removed') return { ok: false, error: `${email} can already sign in to the blog.` };

    const doc: BlogMemberDoc = {
      email,
      name,
      role,
      status: 'invited',
      invitedBy: input.actor,
      invitedAt: new Date(),
      sessionEpoch: newNonce(),
      // Someone coming back keeps the photo and bio they had.
      ...(before?.bio ? { bio: before.bio } : {}),
      ...(before?.avatar ? { avatar: before.avatar } : {}),
    };
    await ref.set(doc);
    const outcome = await sendBlogInvitation(db(), {
      to: email,
      name,
      invitedBy: 'The KGC team',
      roleLabel: roleWords(role),
      link: signInLink(email),
      actor: input.actor,
    });
    await appendAudit({
      actor: input.actor,
      action: 'blog.invite',
      targetPath: `${COLLECTIONS.blogMembers}/${email}`,
      targetId: email,
      before: {},
      after: { email, role, emailed: outcome === 'sent' },
    });
    return {
      ok: true,
      message:
        outcome === 'sent'
          ? `${email} added as ${roleWords(role)}. Their invitation is on its way.`
          : `${email} added as ${roleWords(role)}, but the email did not go out. Send them ${signInLink(email)}.`,
    };
  } catch (err) {
    recordError('blog.invite', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not add them.' };
  }
}

async function existing(email: string): Promise<BlogMemberDoc | null> {
  const d = (await col().doc(email).get()).data() as BlogMemberDoc | undefined;
  return d && d.status !== 'removed' ? d : null;
}

export async function setBlogRole(input: { email: string; role: BlogRole; actor: string }): Promise<BlogResult> {
  const email = input.email.trim().toLowerCase();
  if (fixedBlogEditors().includes(email)) return { ok: false, error: 'That address is an editor in the server settings.' };
  const m = await existing(email);
  if (!m) return { ok: false, error: 'They no longer have blog access.' };
  const role: BlogRole = input.role === 'editor' ? 'editor' : 'writer';
  try {
    await col().doc(email).update({ role, sessionEpoch: newNonce() });
    await appendAudit({
      actor: input.actor,
      action: 'blog.role',
      targetPath: `${COLLECTIONS.blogMembers}/${email}`,
      targetId: email,
      before: { role: m.role },
      after: { role },
    });
    return { ok: true, message: `${m.name || email} is now ${roleWords(role)}.` };
  } catch (err) {
    recordError('blog.role', err);
    return { ok: false, error: 'Could not change their role.' };
  }
}

/** Ends blog access at once. Their posts stay, and editors can still publish or remove them. */
export async function removeBlogPerson(input: { email: string; actor: string }): Promise<BlogResult> {
  const email = input.email.trim().toLowerCase();
  if (fixedBlogEditors().includes(email)) return { ok: false, error: 'That address is an editor in the server settings.' };
  const m = await existing(email);
  if (!m) return { ok: false, error: 'They already have no blog access.' };
  try {
    await col().doc(email).update({ status: 'removed', sessionEpoch: newNonce() });
    await appendAudit({
      actor: input.actor,
      action: 'blog.remove',
      targetPath: `${COLLECTIONS.blogMembers}/${email}`,
      targetId: email,
      before: { role: m.role, status: m.status },
      after: { status: 'removed' },
    });
    return { ok: true, message: `${m.name || email} can no longer sign in to the blog. Their posts stay.` };
  } catch (err) {
    recordError('blog.remove', err);
    return { ok: false, error: 'Could not remove them.' };
  }
}

export async function resendBlogInvitation(input: { email: string; actor: string }): Promise<BlogResult> {
  const email = input.email.trim().toLowerCase();
  const m = await existing(email);
  if (!m) return { ok: false, error: 'They no longer have blog access.' };
  const outcome = await sendBlogInvitation(db(), {
    to: email,
    name: m.name,
    invitedBy: 'The KGC team',
    roleLabel: roleWords(m.role),
    link: signInLink(email),
    actor: input.actor,
  });
  await appendAudit({
    actor: input.actor,
    action: 'blog.resendInvitation',
    targetPath: `${COLLECTIONS.blogMembers}/${email}`,
    targetId: email,
    before: {},
    after: { emailed: outcome === 'sent' },
  });
  return outcome === 'sent'
    ? { ok: true, message: `Invitation sent again to ${email}.` }
    : { ok: false, error: `The email to ${email} did not go out. Send them ${signInLink(email)}.` };
}
