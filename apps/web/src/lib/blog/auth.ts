import 'server-only';

import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COLLECTIONS } from '@kgc/shared';
import { sendBlogSignInCode } from '@kgc/scripts/src/lib/email';
import { db } from '@/lib/firestore';
import type { Viewer } from './access';
import { blogPath } from './paths';
import {
  codesMatch,
  decodeSession,
  encodeSession,
  hashCode,
  normaliseEmail,
} from './session-token';
import type { BlogMemberDoc } from './types';

/**
 * Signing in to the blog editor: an address, then a six-digit code mailed to it.
 *
 * No passwords. The writers are guests who post a few times a year, and a
 * password they chose once and forgot is a support email every time. The code
 * proves they hold the inbox, which is all an invitation ever established.
 *
 * Who may ask for a code: anyone in `blogMembers` who has not been removed,
 * plus the addresses in `BLOG_EDITORS`, who are editors whatever the database
 * says. That variable is how the first editor gets in, and how an editor can
 * never be locked out by a mistake on the People screen.
 */

const COOKIE = 'kgc_blog_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_MS = 10 * 60 * 1000;
const CODE_RESEND_MS = 45 * 1000;
const MAX_TRIES = 5;

export const NOT_RECOGNISED = 'Email not recognised. Ask a KGC editor to invite you.';

function secret(): string {
  const own = process.env.BLOG_SESSION_SECRET;
  if (own && own.length >= 16) return own;
  // Derived from the order secret the site already has, so staging needs no
  // new setting. Derived rather than reused, so the two keys cannot sign each
  // other's tokens.
  const base = process.env.WEB_ORDER_SECRET;
  if (base && base.length >= 16) return createHmac('sha256', base).update('kgc-blog-session').digest('hex');
  throw new Error('Set BLOG_SESSION_SECRET (16+ characters) to use the blog editor.');
}

export function envEditors(): string[] {
  return (process.env.BLOG_EDITORS ?? '')
    .split(',')
    .map((e) => normaliseEmail(e))
    .filter((e): e is string => Boolean(e));
}

const members = () => db().collection(COLLECTIONS.blogMembers);
const codes = () => db().collection(COLLECTIONS.blogSignInCodes);

export async function getMember(email: string): Promise<BlogMemberDoc | null> {
  const snap = await members().doc(email).get();
  return snap.exists ? (snap.data() as BlogMemberDoc) : null;
}

/** May this address sign in at all? */
async function mayEnter(email: string): Promise<boolean> {
  if (envEditors().includes(email)) return true;
  const m = await getMember(email);
  return Boolean(m && m.status !== 'removed');
}

/**
 * Mail a code, or say plainly that the address has no access.
 *
 * It used to answer the same way for every address, so the form could not be
 * used to learn who writes for the blog. The owner chose the plain answer
 * instead (2026-09-26): someone who mistyped their address, or was never
 * invited, should be told rather than left waiting for an email.
 */
export async function requestCode(rawEmail: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const email = normaliseEmail(rawEmail);
  if (!email) return { ok: false, error: 'Enter a valid email address.' };
  if (!(await mayEnter(email))) return { ok: false, error: NOT_RECOGNISED };

  const ref = codes().doc(email);
  const prior = await ref.get();
  const sentAt = (prior.data()?.sentAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
  if (Date.now() - sentAt < CODE_RESEND_MS) return { ok: true, email };

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await ref.set({
    hash: hashCode(secret(), email, code),
    expiresAt: new Date(Date.now() + CODE_MS),
    sentAt: new Date(),
    tries: 0,
  });
  const outcome = await sendBlogSignInCode(db(), { to: email, code, expiresLabel: '10 minutes' });
  if (outcome !== 'sent' && process.env.NODE_ENV !== 'production') {
    // Local development usually runs with email off. The code is useless
    // outside this machine, and this line never runs in production.
    console.info(`[blog] sign-in code for ${email}: ${code} (email ${outcome})`);
  }
  if (outcome === 'failed') return { ok: false, error: 'The email could not be sent. Try again in a minute.' };
  return { ok: true, email };
}

/** Check a code and set the session cookie. */
export async function verifyCode(rawEmail: string, rawCode: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normaliseEmail(rawEmail);
  const code = rawCode.replace(/\D/g, '');
  const wrong = { ok: false as const, error: 'That code is not right, or it has expired.' };
  if (!email || code.length !== 6) return wrong;

  const ref = codes().doc(email);
  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as { hash: string; expiresAt: { toMillis(): number }; tries: number } | undefined;
    if (!data) return false;
    if (data.expiresAt.toMillis() < Date.now() || data.tries >= MAX_TRIES) {
      tx.delete(ref);
      return false;
    }
    if (!codesMatch(data.hash, hashCode(secret(), email, code))) {
      tx.update(ref, { tries: data.tries + 1 });
      return false;
    }
    tx.delete(ref);
    return true;
  });
  if (!result || !(await mayEnter(email))) return wrong;

  // First sign-in of an editor named in BLOG_EDITORS creates their profile.
  const memberRef = members().doc(email);
  const existing = await getMember(email);
  const member: BlogMemberDoc = existing
    ? { ...existing, status: 'active', lastSignInAt: new Date() }
    : {
        email,
        name: email.split('@')[0],
        role: 'editor',
        status: 'active',
        lastSignInAt: new Date(),
        sessionEpoch: randomBytes(8).toString('hex'),
      };
  if (envEditors().includes(email)) member.role = 'editor';
  await memberRef.set(member);

  (await cookies()).set(
    COOKIE,
    encodeSession(secret(), { email, expiresAt: Date.now() + SESSION_MS, epoch: member.sessionEpoch }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MS / 1000,
    },
  );
  return { ok: true };
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The person behind this request, re-checked against the database every time. */
export const currentViewer = cache(async (): Promise<(Viewer & { member: BlogMemberDoc }) | null> => {
  const session = decodeSession(secret(), (await cookies()).get(COOKIE)?.value);
  if (!session) return null;
  const member = await getMember(session.email);
  if (!member || member.status === 'removed' || member.sessionEpoch !== session.epoch) return null;
  const role = envEditors().includes(member.email) ? 'editor' : member.role;
  return { email: member.email, name: member.name, role, member };
});

/** For pages: the viewer, or a trip to the sign-in page. */
export async function requireViewer(): Promise<Viewer & { member: BlogMemberDoc }> {
  const viewer = await currentViewer();
  if (!viewer) redirect(await blogPath('/write/sign-in'));
  return viewer;
}

export const newEpoch = () => randomBytes(8).toString('hex');
