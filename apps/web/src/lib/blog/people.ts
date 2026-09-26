import 'server-only';

import { COLLECTIONS } from '@kgc/shared';
import { sendBlogInvitation } from '@kgc/scripts/src/lib/email';
import { db } from '@/lib/firestore';
import { canManagePeople, type BlogRole, type Viewer } from './access';
import { envEditors, getMember, newEpoch } from './auth';
import { blogUrl } from './paths';
import { normaliseEmail } from './session-token';
import { BlogError } from './store';
import type { BlogMemberDoc } from './types';

/**
 * Inviting people to write, and changing or ending their access. Editors only.
 *
 * Any change to someone's access rotates their `sessionEpoch`, which signs them
 * out everywhere on their next request.
 */

const members = () => db().collection(COLLECTIONS.blogMembers);

function assertEditor(viewer: Viewer) {
  if (!canManagePeople(viewer)) throw new BlogError('Only an editor can manage people.');
}

const roleLabel = (role: BlogRole) => (role === 'editor' ? 'an editor' : 'a writer');

export async function invite(
  viewer: Viewer,
  input: { email: string; name: string; role: BlogRole },
): Promise<{ email: string; sent: boolean }> {
  assertEditor(viewer);
  const email = normaliseEmail(input.email);
  if (!email) throw new BlogError('Enter a valid email address.');
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name) throw new BlogError('Add their name. It is the byline on their posts.');
  const role: BlogRole = input.role === 'editor' ? 'editor' : 'writer';

  const existing = await getMember(email);
  if (existing && existing.status !== 'removed') throw new BlogError(`${email} already has access.`);

  const member: BlogMemberDoc = {
    email,
    name,
    role,
    status: 'invited',
    invitedBy: viewer.email,
    invitedAt: new Date(),
    sessionEpoch: newEpoch(),
    ...(existing?.bio ? { bio: existing.bio } : {}),
    ...(existing?.avatar ? { avatar: existing.avatar } : {}),
  };
  await members().doc(email).set(member);
  const outcome = await sendBlogInvitation(db(), {
    to: email,
    name,
    invitedBy: viewer.name,
    roleLabel: roleLabel(role),
    link: blogUrl(`/write/sign-in?email=${encodeURIComponent(email)}`),
    actor: viewer.email,
  });
  return { email, sent: outcome === 'sent' };
}

export async function resendInvite(viewer: Viewer, rawEmail: string): Promise<boolean> {
  assertEditor(viewer);
  const member = await getMember(rawEmail);
  if (!member || member.status === 'removed') throw new BlogError('That person no longer has access.');
  const outcome = await sendBlogInvitation(db(), {
    to: member.email,
    name: member.name,
    invitedBy: viewer.name,
    roleLabel: roleLabel(member.role),
    link: blogUrl(`/write/sign-in?email=${encodeURIComponent(member.email)}`),
    actor: viewer.email,
  });
  return outcome === 'sent';
}

export async function setRole(viewer: Viewer, rawEmail: string, role: BlogRole): Promise<void> {
  assertEditor(viewer);
  const member = await getMember(rawEmail);
  if (!member || member.status === 'removed') throw new BlogError('That person no longer has access.');
  if (member.email === viewer.email) throw new BlogError('You cannot change your own role.');
  if (envEditors().includes(member.email)) throw new BlogError('This address is an editor in the site settings.');
  await members().doc(member.email).update({ role: role === 'editor' ? 'editor' : 'writer', sessionEpoch: newEpoch() });
}

/** Ends access. Their posts stay, and stay theirs; an editor can still publish or remove them. */
export async function removeMember(viewer: Viewer, rawEmail: string): Promise<void> {
  assertEditor(viewer);
  const member = await getMember(rawEmail);
  if (!member) return;
  if (member.email === viewer.email) throw new BlogError('You cannot remove yourself.');
  if (envEditors().includes(member.email)) throw new BlogError('This address is an editor in the site settings.');
  await members().doc(member.email).update({ status: 'removed', sessionEpoch: newEpoch() });
}

export async function updateProfile(
  viewer: Viewer,
  input: { name: string; bio: string; avatar: string | null },
): Promise<void> {
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name) throw new BlogError('Your name cannot be empty.');
  const bio = input.bio.trim().slice(0, 800);
  const avatar = input.avatar && /^\/blog-media\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(input.avatar) ? input.avatar : null;
  await members().doc(viewer.email).update({ name, bio, avatar });
}
