import 'server-only';

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { headers } from 'next/headers';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@kgc/shared';
import { sendAccessCode } from '@kgc/scripts/src/lib/email';
import {
  DEFAULT_CODE_LIMITS,
  callerIpFromHeaders,
  codeRequestAllowed,
  codeVerifyGate,
  guessesLocked,
  limitId,
  takeAllowance,
  perHourAndDay,
  recordFailedGuess,
  type CodeLimits,
} from '@kgc/scripts/src/lib/rate-limit';
import { db } from './firestore';

/**
 * Six-digit codes emailed to an organizer: to sign in, and to confirm an action
 * that cannot be taken back (a refund, an erasure, a mass send).
 *
 * The same scheme as the blog editor's (`apps/web/src/lib/blog/auth.ts`): a
 * code lives ten minutes, is stored only as a hash bound to its address and
 * purpose, and dies after five wrong tries. `consoleSignInCodes/{email}` holds
 * a sign-in code and `{email}__confirm` a confirmation code, so asking for one
 * never cancels the other.
 *
 * ── Limits (T264) ───────────────────────────────────────────────────────────
 *
 * The code document alone was no limit: it was deleted when its tries ran out,
 * so a script could ask for a new code at once and guess an owner's code
 * without end (T263 P1). Now every request counts against an hourly and daily
 * cap per address and per IP, and every wrong code counts against the address
 * across codes (`@kgc/scripts` rate-limit.ts), in documents that outlive the
 * code. An exhausted code is also kept until it expires, so the 30-second
 * resend floor holds after it.
 */

export type CodePurpose = 'signin' | 'confirm';

const CODE_MS = 10 * 60 * 1000;
const RESEND_MS = 30 * 1000;
const MAX_TRIES = 5;

function secret(): string {
  const s = process.env.CONSOLE_SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('CONSOLE_SESSION_SECRET is missing or too short.');
  return s;
}

/** Confirm codes come from a signed-in organizer, and a busy refund day needs several. */
const LIMITS: Record<CodePurpose, CodeLimits> = {
  signin: DEFAULT_CODE_LIMITS,
  confirm: { ...DEFAULT_CODE_LIMITS, requestPerEmail: perHourAndDay(20, 60) },
};
const scope = (purpose: CodePurpose) => (purpose === 'signin' ? 'dash-signin' : 'dash-confirm');
const store = () => db() as unknown as Firestore;

/** The caller's IP, or undefined outside a request (a script, a test). */
async function callerIp(): Promise<string | undefined> {
  try {
    return callerIpFromHeaders(await headers());
  } catch {
    return undefined;
  }
}

/**
 * Count one sign-in lookup from this IP, before the address is checked.
 *
 * "Email not recognised" stays (owner decision, 2026-09-26), so the form still
 * says which addresses are organizers. This caps how fast one IP can ask.
 */
export async function lookupAllowed(): Promise<boolean> {
  const ip = await callerIp();
  return takeAllowance(store(), [
    { id: ip ? limitId('dash-lookup', 'ip', ip) : undefined, kind: 'dash-lookup-ip', caps: perHourAndDay(30, 100) },
  ]);
}

const docId = (email: string, purpose: CodePurpose) => (purpose === 'signin' ? email : `${email}__confirm`);
const hash = (email: string, purpose: CodePurpose, code: string) =>
  createHash('sha256').update(`${secret()}\u0000${purpose}\u0000${email}\u0000${code}`).digest('hex');

/**
 * Mail a code. A second request within half a minute is quietly the first one,
 * so a double click does not send two codes (and is not counted). `limited`
 * when the address or IP has asked for too many, or the address is locked
 * after too many wrong codes; nothing is sent then.
 */
export async function issueCode(email: string, purpose: CodePurpose): Promise<'sent' | 'failed' | 'limited'> {
  const ref = db().collection(COLLECTIONS.consoleSignInCodes).doc(docId(email, purpose));
  const prior = (await ref.get()).data() as { sentAt?: { toMillis(): number } } | undefined;
  if (prior?.sentAt && Date.now() - prior.sentAt.toMillis() < RESEND_MS) return 'sent';

  const ip = await callerIp();
  if (await guessesLocked(store(), scope(purpose), email)) return 'limited';
  if (!(await codeRequestAllowed(store(), scope(purpose), email, ip, LIMITS[purpose]))) return 'limited';

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await ref.set({ hash: hash(email, purpose, code), expiresAt: new Date(Date.now() + CODE_MS), sentAt: new Date(), tries: 0 });
  const outcome = await sendAccessCode(db(), {
    to: email,
    code,
    expiresLabel: '10 minutes',
    surface: purpose === 'signin' ? 'dashboard' : 'dashboard-confirm',
  });
  if (outcome !== 'sent' && process.env.NODE_ENV !== 'production') {
    // Local development runs with email off. Never printed in production.
    console.info(`[dashboard] ${purpose} code for ${email}: ${code} (email ${outcome})`);
    return 'sent';
  }
  return outcome === 'sent' ? 'sent' : 'failed';
}

/**
 * `ok` once, for the right code within ten minutes and five tries. `locked`
 * after too many wrong codes for this address (across codes), `limited` when
 * this IP has tried too many; the code is not looked at in either case.
 */
export async function checkCode(
  email: string,
  purpose: CodePurpose,
  raw: string,
): Promise<'ok' | 'wrong' | 'locked' | 'limited'> {
  const code = raw.replace(/\D/g, '');
  if (code.length !== 6) return 'wrong';
  const gate = await codeVerifyGate(store(), scope(purpose), email, await callerIp(), LIMITS[purpose]);
  if (gate !== 'ok') return gate;
  const ref = db().collection(COLLECTIONS.consoleSignInCodes).doc(docId(email, purpose));
  const outcome = await db().runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() as { hash: string; expiresAt: { toMillis(): number }; tries: number } | undefined;
    if (!d) return 'none' as const;
    if (d.expiresAt.toMillis() < Date.now()) {
      tx.delete(ref);
      return 'none' as const;
    }
    // Spent, but kept until it expires: deleting it here let the next request
    // skip the resend floor (T263).
    if (d.tries >= MAX_TRIES) return 'none' as const;
    const a = Buffer.from(d.hash);
    const b = Buffer.from(hash(email, purpose, code));
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      tx.update(ref, { tries: d.tries + 1 });
      return 'wrong' as const;
    }
    tx.delete(ref);
    return 'ok' as const;
  });
  if (outcome === 'ok') return 'ok';
  // Only a guess against a live code counts, so locking somebody out takes
  // asking for a code, which mails them.
  if (outcome === 'wrong') await recordFailedGuess(store(), scope(purpose), email);
  return 'wrong';
}
