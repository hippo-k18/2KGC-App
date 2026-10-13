import 'server-only';

import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { COLLECTIONS, EVENT_ID, heldTicketNames, type RegistrationDoc } from '@kgc/shared';
import { sendBlogSignInCode } from '@kgc/scripts/src/lib/email';
import { db } from '@/lib/firestore';
import {
  codesMatch,
  decodeSession,
  encodeSession,
  hashCode,
  normaliseEmail,
} from '@/lib/blog/session-token';

/**
 * Which ticket the person reading a session page holds.
 *
 * Streams and recordings are sold with a ticket, so a session page has to know
 * which ticket the reader bought. The site has no accounts, so a ticket holder
 * signs in the way the blog editor does: their address, then a six-digit code
 * mailed to it. The code proves they hold the inbox the ticket was bought with,
 * which is the only thing that ever tied a person to a registration.
 *
 * This replaced "Watch on this device" (2026-09-26), a button on the order
 * page that stored the order link in a cookie. The owner asked for an email
 * sign-in on the session page instead, which also works on a device that
 * never opened the confirmation email.
 *
 * ── What the cookie holds ───────────────────────────────────────────────────
 *
 * A signed `{ email, expiresAt }`, and nothing about the ticket. The
 * registration is re-read on every request, so a refunded or transferred ticket
 * stops playing video immediately, with no session to expire.
 *
 * `HttpOnly` so no script can read it, `SameSite=Lax` so it survives following
 * a link, and `Secure` off the local dev server only.
 */

export const TICKET_PASS_COOKIE = 'kgc_ticket';

/** Six months: the conference and the recording window after it. */
const SESSION_MS = 180 * 24 * 60 * 60 * 1000;
const CODE_MS = 10 * 60 * 1000;
const CODE_RESEND_MS = 45 * 1000;
const MAX_TRIES = 5;

function secret(): string {
  // Derived from the order secret the site already has, so no new setting.
  // Derived rather than reused, so the two keys cannot sign each other's tokens.
  const base = process.env.WEB_ORDER_SECRET;
  if (base && base.length >= 16) return createHmac('sha256', base).update('kgc-ticket-session').digest('hex');
  throw new Error('Set WEB_ORDER_SECRET (16+ characters) to sign in ticket holders.');
}

const codes = () => db().collection(COLLECTIONS.ticketSignInCodes);

export interface TicketPass {
  email: string;
  name: string;
  /**
   * `RegistrationDoc.ticketType` of every active ticket this address holds,
   * and any extras on those badges (`extraNames`):
   * the names, because that is what `allowedTicketTypes` holds. Usually one;
   * an address may hold several since 2026-09-26.
   */
  ticketTypes: string[];
}

/**
 * The active tickets for this address at this event, or null for none.
 *
 * `active` and nothing else. A cancelled or transferred ticket keeps its
 * document (the desk still needs an answer about the badge), so a document
 * existing is not the same as holding a valid ticket, and a refunded buyer must
 * lose the video with the money.
 */
async function activeTickets(email: string): Promise<TicketPass | null> {
  const snap = await db()
    .collection(COLLECTIONS.registrations)
    .where('email', '==', email)
    .where('eventId', '==', EVENT_ID)
    .get();
  const regs = snap.docs.map((d) => d.data() as RegistrationDoc).filter((r) => r.status === 'active');
  if (regs.length === 0) return null;
  return {
    email,
    name: regs.find((r) => r.name?.trim())?.name?.trim() || email,
    // Extras on a badge (Workshops) count like a ticket of their own here.
    ticketTypes: [...new Set(regs.flatMap((r) => heldTicketNames(r).map((t) => t.trim())).filter(Boolean))],
  };
}

/**
 * Resolve the cookie to a live, active registration, or null.
 *
 * Null for every failure without saying which: no cookie, a forged one, an
 * expired one, or a ticket that has since been cancelled.
 */
export const readTicketPass = cache(async (): Promise<TicketPass | null> => {
  try {
    const session = decodeSession(secret(), (await cookies()).get(TICKET_PASS_COOKIE)?.value);
    if (!session) return null;
    return await activeTickets(session.email);
  } catch (err) {
    // A store that cannot be reached is "we do not know which ticket you
    // hold", which is the safe direction, rather than a 500 on a session page.
    console.error('[ticket-pass] could not resolve the ticket cookie', err);
    return null;
  }
});

/**
 * Mail a code if the address holds a ticket, and answer the same either way.
 *
 * ⚠️ Unlike the blog and the dashboard, which say "Email not recognised". Those
 * reveal who writes for the blog; this would reveal who is attending, which
 * `registrationId` goes out of its way not to (see `scripts/src/lib/ids.ts`).
 * The form tells the person to use the address they bought with instead.
 */
export async function requestTicketCode(
  rawEmail: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const email = normaliseEmail(rawEmail);
  if (!email) return { ok: false, error: 'Enter a valid email address.' };
  if (!(await activeTickets(email))) return { ok: true, email };

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
  const outcome = await sendBlogSignInCode(db(), { to: email, code, expiresLabel: '10 minutes', surface: 'ticket' });
  if (outcome !== 'sent' && process.env.NODE_ENV !== 'production') {
    // Local development usually runs with email off. This never runs in production.
    console.info(`[ticket] sign-in code for ${email}: ${code} (email ${outcome})`);
  }
  if (outcome === 'failed') return { ok: false, error: 'The email could not be sent. Try again in a minute.' };
  return { ok: true, email };
}

/** Check a code and set the ticket cookie. */
export async function verifyTicketCode(
  rawEmail: string,
  rawCode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normaliseEmail(rawEmail);
  const code = rawCode.replace(/\D/g, '');
  const wrong = { ok: false as const, error: 'That code is not right, or it has expired.' };
  if (!email || code.length !== 6) return wrong;

  const ref = codes().doc(email);
  const matched = await db().runTransaction(async (tx) => {
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
  if (!matched || !(await activeTickets(email))) return wrong;

  (await cookies()).set(
    TICKET_PASS_COOKIE,
    // `epoch` is required by the shared token format and unused here: the
    // registration is re-read on every request, which is the revocation.
    encodeSession(secret(), { email, expiresAt: Date.now() + SESSION_MS, epoch: randomBytes(4).toString('hex') }),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MS / 1000,
    },
  );
  return { ok: true };
}

export async function clearTicketPass(): Promise<void> {
  (await cookies()).delete(TICKET_PASS_COOKIE);
}
