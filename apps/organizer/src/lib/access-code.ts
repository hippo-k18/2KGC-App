import 'server-only';

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { COLLECTIONS } from '@kgc/shared';
import { sendAccessCode } from '@kgc/scripts/src/lib/email';
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

const docId = (email: string, purpose: CodePurpose) => (purpose === 'signin' ? email : `${email}__confirm`);
const hash = (email: string, purpose: CodePurpose, code: string) =>
  createHash('sha256').update(`${secret()}\u0000${purpose}\u0000${email}\u0000${code}`).digest('hex');

/**
 * Mail a code. Returns false only when the email could not be sent; a second
 * request within half a minute is quietly the first one, so a double click
 * does not send two codes.
 */
export async function issueCode(email: string, purpose: CodePurpose): Promise<'sent' | 'failed'> {
  const ref = db().collection(COLLECTIONS.consoleSignInCodes).doc(docId(email, purpose));
  const prior = (await ref.get()).data() as { sentAt?: { toMillis(): number } } | undefined;
  if (prior?.sentAt && Date.now() - prior.sentAt.toMillis() < RESEND_MS) return 'sent';

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

/** True once, for the right code within ten minutes and five tries. */
export async function checkCode(email: string, purpose: CodePurpose, raw: string): Promise<boolean> {
  const code = raw.replace(/\D/g, '');
  if (code.length !== 6) return false;
  const ref = db().collection(COLLECTIONS.consoleSignInCodes).doc(docId(email, purpose));
  return db().runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() as { hash: string; expiresAt: { toMillis(): number }; tries: number } | undefined;
    if (!d) return false;
    if (d.expiresAt.toMillis() < Date.now() || d.tries >= MAX_TRIES) {
      tx.delete(ref);
      return false;
    }
    const a = Buffer.from(d.hash);
    const b = Buffer.from(hash(email, purpose, code));
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      tx.update(ref, { tries: d.tries + 1 });
      return false;
    }
    tx.delete(ref);
    return true;
  });
}
