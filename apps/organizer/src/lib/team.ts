import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { headers } from 'next/headers';
import { COLLECTIONS, EVENT_ID, type TeamMemberDoc, type TeamRole } from '@kgc/shared';
import { sendTeamInvitation } from '@kgc/scripts/src/lib/email';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';
import { ROLE_LABELS, looksLikeEmail, memberIdFor, newNonce, sameToken } from './team-core';

/**
 * `teamMembers` — the people an owner has invited, beside the env allowlist.
 *
 * The allowlist is untouched by anything here: those addresses stay owners,
 * which is what lets somebody back in when this collection is empty or wrong.
 * Everything in this file is about the other kind of person: added by an owner,
 * limited by role, and signing in the same way, with a code emailed to them.
 *
 * `lib/auth.ts` reads members through `findMember()` on every request, so a
 * removal or a role change takes effect on the member's next click rather than
 * at their next sign-in. The decisions about *what* a role opens are in
 * `team-core.ts`; this file only keeps the documents.
 */

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  roles: TeamRole[];
  status: TeamMemberDoc['status'];
  sessionEpoch: string;
  invitedBy: string;
  /** ISO strings, so a row can cross into a client component. */
  invitedAt: string | null;
  lastSignInAt: string | null;
}

export type TeamResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const iso = (t: unknown): string | null =>
  t instanceof Timestamp ? t.toDate().toISOString() : null;

function toMember(id: string, d: TeamMemberDoc): TeamMember {
  return {
    id,
    email: d.email,
    name: d.name ?? '',
    roles: d.roles ?? [],
    status: d.status,
    sessionEpoch: d.sessionEpoch,
    invitedBy: d.invitedBy,
    invitedAt: iso(d.createdAt),
    lastSignInAt: iso(d.lastSignInAt),
  };
}

const members = () => db().collection(COLLECTIONS.teamMembers);

export async function listMembers(): Promise<TeamMember[]> {
  // Filtered in memory rather than with `where('eventId')` plus an `orderBy`:
  // that pair needs a composite index, the emulator would not say so, and a
  // team is a dozen documents.
  const snap = await members().get();
  return snap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as TeamMemberDoc }))
    .filter((m) => m.data.eventId === EVENT_ID)
    .map((m) => toMember(m.id, m.data))
    .sort((a, b) => a.email.localeCompare(b.email));
}

/** One read by id. The id is derived from the address, so no query is needed. */
export async function findMember(email: string): Promise<TeamMember | null> {
  const id = memberIdFor(email);
  const snap = await members().doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() as TeamMemberDoc;
  return data.eventId === EVENT_ID ? toMember(id, data) : null;
}

export async function stampSignIn(memberId: string): Promise<void> {
  try {
    // Signing in accepts the invitation too, for anyone who never opened the link.
    await members()
      .doc(memberId)
      .update({ lastSignInAt: FieldValue.serverTimestamp(), status: 'active', inviteToken: FieldValue.delete() });
  } catch (err) {
    recordError('team.stampSignIn', err);
  }
}

/**
 * Opening the link in an invitation accepts it: the row on Admin Settings goes
 * from Invited to Active. It grants nothing by itself, since getting in still
 * takes a code sent to the address. Before this the link was a bare `/login`,
 * so the row stayed Invited until a code was entered, and never changed at all
 * when the link was opened in a browser already signed in as someone else.
 */
export async function acceptInvitation(email: string, token: string): Promise<void> {
  try {
    const ref = members().doc(memberIdFor(email));
    const snap = await ref.get();
    const d = snap.data() as TeamMemberDoc | undefined;
    if (!d || d.eventId !== EVENT_ID || d.status !== 'invited' || !sameToken(d.inviteToken, token)) return;
    await ref.update({ status: 'active', inviteToken: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    await appendAudit({
      actor: d.email,
      action: 'team.acceptInvitation',
      targetPath: `${COLLECTIONS.teamMembers}/${snap.id}`,
      targetId: snap.id,
      before: { status: 'invited' },
      after: { status: 'active' },
    });
  } catch (err) {
    recordError('team.acceptInvitation', err);
  }
}

// ---------------------------------------------------------------------------
// Telling them
// ---------------------------------------------------------------------------

/**
 * Where this dashboard is reachable, for a link that goes into an email.
 *
 * `ORGANIZER_PUBLIC_ORIGIN` when it is set; otherwise the host this request
 * arrived on, which is right whenever an owner is pressing the button from the
 * address their team will use.
 */
async function dashboardOrigin(): Promise<string> {
  const configured = process.env.ORGANIZER_PUBLIC_ORIGIN;
  if (configured) return configured.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3100';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

const rolesLabel = (roles: TeamRole[]) => roles.map((r) => ROLE_LABELS[r].label).join(', ');

/** Tell someone they have been added. There is no link to guard: they sign in with a code. */
async function sendInvite(
  member: Pick<TeamMember, 'email' | 'name' | 'roles'>,
  actor: string,
  inviteToken: string | undefined,
): Promise<{ emailed: boolean; signInUrl: string }> {
  const signInUrl = `${await dashboardOrigin()}/login`;
  const params = new URLSearchParams({ email: member.email });
  if (inviteToken) params.set('invite', inviteToken);
  const outcome = await sendTeamInvitation(db(), {
    to: member.email,
    name: member.name || undefined,
    rolesLabel: rolesLabel(member.roles),
    link: `${signInUrl}?${params}`,
    actor,
  });
  return { emailed: outcome === 'sent', signInUrl };
}

const inviteMessage = (email: string, emailed: boolean, signInUrl: string) =>
  emailed
    ? `An email telling ${email} how to sign in is on its way.`
    : `The email to ${email} did not go out. Tell them to sign in at ${signInUrl} with this address.`;

export async function inviteMember(input: {
  email: string;
  name: string;
  roles: TeamRole[];
  actor: string;
}): Promise<TeamResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!looksLikeEmail(email)) return { ok: false, error: 'Enter an email address.' };
  if (name.length > 120) return { ok: false, error: 'Keep the name under 120 characters.' };
  if (input.roles.length === 0) return { ok: false, error: 'Pick at least one role.' };

  try {
    const id = memberIdFor(email);
    const ref = members().doc(id);
    // `create`, not `set`: a second invitation to the same address must not
    // quietly reset the first one's roles.
    const inviteToken = newNonce();
    try {
      await ref.create({
        eventId: EVENT_ID,
        email,
        ...(name ? { name } : {}),
        roles: input.roles,
        status: 'invited',
        inviteToken,
        sessionEpoch: newNonce(),
        invitedBy: input.actor,
        updatedBy: input.actor,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      if ((err as { code?: number }).code === 6) {
        return { ok: false, error: `${email} is already on the team. Change their roles in the table.` };
      }
      throw err;
    }

    const { emailed, signInUrl } = await sendInvite({ email, name, roles: input.roles }, input.actor, inviteToken);

    await appendAudit({
      actor: input.actor,
      action: 'team.invite',
      targetPath: `${COLLECTIONS.teamMembers}/${id}`,
      targetId: id,
      before: {},
      after: { email, roles: input.roles, emailed },
    });

    return { ok: true, message: `${email} added. ${inviteMessage(email, emailed, signInUrl)}` };
  } catch (err) {
    recordError('team.inviteMember', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not invite them.' };
  }
}

export async function setMemberRoles(input: {
  memberId: string;
  roles: TeamRole[];
  actor: string;
}): Promise<TeamResult> {
  if (input.roles.length === 0) {
    return { ok: false, error: 'Pick at least one role, or remove them from the team.' };
  }
  try {
    const ref = members().doc(input.memberId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'They are no longer on the team.' };
    const before = snap.data() as TeamMemberDoc;

    await ref.update({
      roles: input.roles,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: input.actor,
    });
    await appendAudit({
      actor: input.actor,
      action: 'team.roles',
      targetPath: `${COLLECTIONS.teamMembers}/${input.memberId}`,
      targetId: input.memberId,
      before: { email: before.email, roles: before.roles },
      after: { email: before.email, roles: input.roles },
    });
    return { ok: true, message: `${before.email} now has: ${rolesLabel(input.roles)}.` };
  } catch (err) {
    recordError('team.setMemberRoles', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not change their roles.' };
  }
}

export async function resendInvitation(input: { memberId: string; actor: string }): Promise<TeamResult> {
  try {
    const snap = await members().doc(input.memberId).get();
    if (!snap.exists) return { ok: false, error: 'They are no longer on the team.' };
    const data = snap.data() as TeamMemberDoc;
    const member = toMember(snap.id, data);
    // Invitations sent before links carried a token get one now.
    let inviteToken = data.inviteToken;
    if (data.status === 'invited' && !inviteToken) {
      inviteToken = newNonce();
      await snap.ref.update({ inviteToken });
    }
    const { emailed, signInUrl } = await sendInvite(member, input.actor, inviteToken);
    await appendAudit({
      actor: input.actor,
      action: 'team.resendInvitation',
      targetPath: `${COLLECTIONS.teamMembers}/${member.id}`,
      targetId: member.id,
      before: {},
      after: { email: member.email, emailed },
    });
    return { ok: true, message: inviteMessage(member.email, emailed, signInUrl) };
  } catch (err) {
    recordError('team.resendInvitation', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not send it.' };
  }
}

/**
 * Deletes the document, which is the revocation: the guard finds no member for
 * the address in the cookie and the next request lands on the sign-in page.
 * The audit entry keeps who they were and what they could open.
 */
export async function removeMember(input: { memberId: string; actor: string }): Promise<TeamResult> {
  try {
    const ref = members().doc(input.memberId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'They are already off the team.' };
    const before = snap.data() as TeamMemberDoc;

    await ref.delete();
    await appendAudit({
      actor: input.actor,
      action: 'team.remove',
      targetPath: `${COLLECTIONS.teamMembers}/${input.memberId}`,
      targetId: input.memberId,
      before: { email: before.email, roles: before.roles, status: before.status },
      after: {},
    });
    return { ok: true, message: `${before.email} removed. They are signed out.` };
  } catch (err) {
    recordError('team.removeMember', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not remove them.' };
  }
}

