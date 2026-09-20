import 'server-only';

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { headers } from 'next/headers';
import { COLLECTIONS, EVENT_ID, type TeamMemberDoc, type TeamRole } from '@kgc/shared';
import { emailEnabled, sendTeamInvitation } from '@kgc/scripts/src/lib/email';
import { appendAudit } from './audit';
import { recordError } from './errors';
import { db } from './firestore';
import {
  ROLE_LABELS,
  SETUP_LINK_TTL_MS,
  hashNonce,
  hashPassphrase,
  looksLikeEmail,
  memberIdFor,
  mintSetupToken,
  newNonce,
  passphraseProblem,
  readSetupToken,
  verifyPassphrase,
} from './team-core';

/**
 * `teamMembers` — the people an owner has invited, beside the env allowlist.
 *
 * The allowlist is untouched by anything here: those addresses stay owners on
 * the shared passphrase, which is what lets somebody back in when this
 * collection is empty or wrong. Everything in this file is about the other
 * kind of person — invited by email, limited by role, holding a passphrase of
 * their own that is stored only as a hash.
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
  passphraseHash?: string;
  invitedBy: string;
  /** ISO strings, so a row can cross into a client component. */
  invitedAt: string | null;
  lastSignInAt: string | null;
  /** True while an unused, unexpired set-passphrase link is outstanding. */
  linkOutstanding: boolean;
}

export type TeamResult =
  | { ok: true; message: string; link?: string }
  | { ok: false; error: string };

const iso = (t: unknown): string | null =>
  t instanceof Timestamp ? t.toDate().toISOString() : null;

function toMember(id: string, d: TeamMemberDoc): TeamMember {
  const expires = d.setupExpiresAt instanceof Timestamp ? d.setupExpiresAt.toMillis() : 0;
  return {
    id,
    email: d.email,
    name: d.name ?? '',
    roles: d.roles ?? [],
    status: d.status,
    sessionEpoch: d.sessionEpoch,
    passphraseHash: d.passphraseHash,
    invitedBy: d.invitedBy,
    invitedAt: iso(d.createdAt),
    lastSignInAt: iso(d.lastSignInAt),
    linkOutstanding: Boolean(d.setupNonceHash) && expires > Date.now(),
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

/** True when the address and passphrase belong to an active member. */
export async function checkMemberPassphrase(
  email: string,
  supplied: string,
): Promise<TeamMember | null> {
  const member = await findMember(email);
  // Hash even when there is nobody to compare against, so the form does not
  // answer "is this address on the team" by how long it takes.
  const ok = verifyPassphrase(supplied, member?.passphraseHash ?? DECOY_HASH);
  return member && member.status === 'active' && ok ? member : null;
}

const DECOY_HASH = hashPassphrase('no member has this passphrase');

export async function stampSignIn(memberId: string): Promise<void> {
  try {
    await members().doc(memberId).update({ lastSignInAt: FieldValue.serverTimestamp() });
  } catch (err) {
    recordError('team.stampSignIn', err);
  }
}

// ---------------------------------------------------------------------------
// The set-passphrase link
// ---------------------------------------------------------------------------

function linkSecret(): string {
  const s = process.env.CONSOLE_SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error('CONSOLE_SESSION_SECRET is missing or too short, so a link cannot be signed.');
  }
  return s;
}

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

/**
 * Mint a fresh link, store its nonce hash, and mail it.
 *
 * A new link replaces the old nonce, so at most one link per member is ever
 * live. The epoch is rotated too: asking for a new link is what an owner does
 * when a passphrase is forgotten or a laptop is lost, and in the second case
 * the old session has to end now, not in eight hours.
 */
async function issueLink(
  member: Pick<TeamMember, 'id' | 'email' | 'name' | 'roles'>,
  actor: string,
): Promise<{ link: string; emailed: boolean }> {
  const nonce = newNonce();
  const expiresAt = Date.now() + SETUP_LINK_TTL_MS;
  await members().doc(member.id).update({
    setupNonceHash: hashNonce(nonce),
    setupExpiresAt: Timestamp.fromMillis(expiresAt),
    sessionEpoch: newNonce(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor,
  });

  const token = mintSetupToken(linkSecret(), { memberId: member.id, nonce, expiresAt });
  const link = `${await dashboardOrigin()}/login/set-passphrase/${token}`;

  await sendTeamInvitation(db(), {
    to: member.email,
    name: member.name || undefined,
    rolesLabel: rolesLabel(member.roles),
    link,
    expiresLabel: '3 days',
    actor,
  });
  return { link, emailed: emailEnabled() };
}

const linkMessage = (email: string, emailed: boolean) =>
  emailed
    ? `Link emailed to ${email}. It works once and expires in 3 days.`
    : `Email is not switched on yet, so nothing was sent to ${email}. Copy the link below and send it yourself. It works once and expires in 3 days.`;

// ---------------------------------------------------------------------------
// What an owner does
// ---------------------------------------------------------------------------

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
    // quietly reset the first one's roles and passphrase.
    try {
      await ref.create({
        eventId: EVENT_ID,
        email,
        ...(name ? { name } : {}),
        roles: input.roles,
        status: 'invited',
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

    const { link, emailed } = await issueLink({ id, email, name, roles: input.roles }, input.actor);

    await appendAudit({
      actor: input.actor,
      action: 'team.invite',
      targetPath: `${COLLECTIONS.teamMembers}/${id}`,
      targetId: id,
      before: {},
      after: { email, roles: input.roles, emailed },
    });

    return { ok: true, message: `${email} invited. ${linkMessage(email, emailed)}`, link };
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

export async function sendNewLink(input: { memberId: string; actor: string }): Promise<TeamResult> {
  try {
    const snap = await members().doc(input.memberId).get();
    if (!snap.exists) return { ok: false, error: 'They are no longer on the team.' };
    const member = toMember(snap.id, snap.data() as TeamMemberDoc);

    const { link, emailed } = await issueLink(member, input.actor);
    await appendAudit({
      actor: input.actor,
      action: 'team.newLink',
      targetPath: `${COLLECTIONS.teamMembers}/${member.id}`,
      targetId: member.id,
      before: {},
      after: { email: member.email, emailed, signedOut: true },
    });
    return { ok: true, message: linkMessage(member.email, emailed), link };
  } catch (err) {
    recordError('team.sendNewLink', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Could not make a new link.' };
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

// ---------------------------------------------------------------------------
// What a member does with their link
// ---------------------------------------------------------------------------

const LINK_DEAD = 'This link has been used or has expired. Ask an owner for a new one.';

/** Who a link is for, or null when it would not work. Reads, never writes. */
export async function memberForLink(token: string): Promise<TeamMember | null> {
  const claim = readSetupToken(linkSecret(), token, Date.now());
  if (!claim) return null;
  const snap = await members().doc(claim.memberId).get();
  if (!snap.exists) return null;
  const data = snap.data() as TeamMemberDoc;
  if (data.setupNonceHash !== hashNonce(claim.nonce)) return null;
  return toMember(snap.id, data);
}

export async function setPassphraseWithLink(token: string, passphrase: string): Promise<TeamResult> {
  const problem = passphraseProblem(passphrase);
  if (problem) return { ok: false, error: problem };

  const claim = readSetupToken(linkSecret(), token, Date.now());
  if (!claim) return { ok: false, error: LINK_DEAD };

  try {
    const ref = members().doc(claim.memberId);
    // In a transaction so two tabs holding the same link cannot both win: the
    // second one reads a document whose nonce is already gone.
    const email = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() as TeamMemberDoc | undefined;
      if (!data || data.setupNonceHash !== hashNonce(claim.nonce)) return null;
      tx.update(ref, {
        passphraseHash: hashPassphrase(passphrase),
        status: 'active',
        setupNonceHash: FieldValue.delete(),
        setupExpiresAt: FieldValue.delete(),
        sessionEpoch: newNonce(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: data.email,
      });
      return data.email;
    });
    if (!email) return { ok: false, error: LINK_DEAD };

    await appendAudit({
      actor: email,
      action: 'team.setPassphrase',
      targetPath: `${COLLECTIONS.teamMembers}/${claim.memberId}`,
      targetId: claim.memberId,
      before: {},
      after: { email, status: 'active' },
    });
    return { ok: true, message: 'Passphrase saved. Sign in with it now.' };
  } catch (err) {
    recordError('team.setPassphraseWithLink', err);
    return { ok: false, error: 'Could not save the passphrase. Try again.' };
  }
}
