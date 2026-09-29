import { randomInt } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type RegistrationDoc } from '@kgc/shared';
import { normaliseEmail } from './ids.js';
import { REFERRAL_ALPHABET, REFERRAL_PREFIX, parseReferralCode, type ReferralUtm } from './referral-codes.js';

/**
 * Referral codes: "who brought whom".
 *
 * Every registrant gets a code like `KGC27-7QF2` at fulfilment. It goes into a
 * personal link in the confirmation email's "Bring your team" block
 * (`/tickets?ref=KGC27-7QF2&utm_source=attendee&…`). The website's middleware
 * keeps `ref` and the UTMs in cookies, checkout carries them through Stripe
 * metadata, and fulfilment stamps `referredBy` on the new registrations.
 *
 * Here rather than in `apps/web` because the organizer dashboard sends the same
 * confirmation email (invoices, manual orders, comp passes) and has to mint the
 * same codes from the same table.
 *
 * ── Uniqueness ──────────────────────────────────────────────────────────────
 *
 * Four characters from a 31-letter alphabet is 923,521 codes, and by the
 * birthday bound a few thousand attendees would collide more often than not. So
 * a code is reserved in `referralCodes/{code}` inside the same transaction that
 * writes it onto the registration, and a taken candidate is skipped. The table
 * is also what resolves a code back to its owner without a query or an index.
 *
 * Native `Date`s only, never a Firestore sentinel: see the note in
 * `fulfilment.ts` about each app resolving its own `firebase-admin`.
 */

export * from './referral-codes.js';

export function mintReferralCode(length = 4): string {
  let body = '';
  for (let i = 0; i < length; i += 1) body += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)];
  return `${REFERRAL_PREFIX}${body}`;
}

/**
 * The registration's referral code, minting and reserving one if it has none.
 *
 * Idempotent: a registration keeps its code for ever, so a replayed webhook or
 * a resent confirmation prints the same link. Returns null when the
 * registration does not exist. Throws only on a Firestore failure; callers on
 * the money path catch it, because a missing code must never cost a ticket.
 */
export async function ensureReferralCode(
  store: Firestore,
  registrationId: string,
  /** Injectable so a test can force a collision. */
  mint: (length?: number) => string = mintReferralCode,
): Promise<string | null> {
  const regRef = store.collection(COLLECTIONS.registrations).doc(registrationId);
  const codes = store.collection(COLLECTIONS.referralCodes);

  return store.runTransaction(async (tx) => {
    const reg = await tx.get(regRef);
    if (!reg.exists) return null;
    const existing = (reg.data() as RegistrationDoc).referralCode;
    if (existing) return existing;

    // Four short candidates and one longer one. Every read before any write.
    const candidates = [...new Set([mint(), mint(), mint(), mint(), mint(6)])];
    const snaps = await Promise.all(candidates.map((c) => tx.get(codes.doc(c))));
    const free = candidates.find((_, i) => !snaps[i]!.exists);
    if (!free) throw new Error(`no free referral code after ${candidates.length} tries`);

    const now = new Date();
    tx.set(codes.doc(free), { eventId: EVENT_ID, registrationId, createdAt: now });
    tx.update(regRef, { referralCode: free, updatedAt: now });
    return free;
  });
}

/** Who owns a code, or null for a malformed, unknown or foreign-event one. */
export async function resolveReferralCode(
  store: Firestore,
  raw: unknown,
): Promise<{ code: string; registrationId: string; email: string } | null> {
  const code = parseReferralCode(raw);
  if (!code) return null;
  const snap = await store.collection(COLLECTIONS.referralCodes).doc(code).get();
  const entry = snap.data() as { eventId?: string; registrationId?: string } | undefined;
  if (!entry || entry.eventId !== EVENT_ID || !entry.registrationId) return null;
  const reg = await store.collection(COLLECTIONS.registrations).doc(entry.registrationId).get();
  if (!reg.exists) return null;
  return { code, registrationId: reg.id, email: (reg.data() as RegistrationDoc).email };
}

export interface RecordReferralResult {
  /** Registrations that were credited to the referrer by this call. */
  credited: string[];
  /** Registrations skipped because they belong to the referrer themselves. */
  selfReferrals: string[];
  /** True when a code was given and did not resolve. */
  invalidCode: boolean;
}

/**
 * Stamp `referredBy` (and the UTMs) onto the registrations one purchase made.
 *
 * Every seat on the order is credited, not only the buyer's: a colleague the
 * buyer paid for still came through the invite. Three things are ignored
 * safely rather than stored: a code that does not resolve, a seat that is the
 * referrer's own (same registration or same address), and a registration that
 * already names a referrer, because the first credit is the real one and a
 * replay must not move it.
 */
export async function recordReferral(
  store: Firestore,
  input: { registrationIds: string[]; code?: string; utm?: ReferralUtm },
): Promise<RecordReferralResult> {
  const result: RecordReferralResult = { credited: [], selfReferrals: [], invalidCode: false };
  const referrer = input.code ? await resolveReferralCode(store, input.code) : null;
  if (input.code && !referrer) result.invalidCode = true;
  if (!referrer && !input.utm) return result;

  const regs = store.collection(COLLECTIONS.registrations);
  for (const rid of [...new Set(input.registrationIds)]) {
    const ref = regs.doc(rid);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const reg = snap.data() as RegistrationDoc;
    const patch: Partial<Pick<RegistrationDoc, 'referredBy' | 'utm'>> = {};

    if (referrer && !reg.referredBy) {
      const self = referrer.registrationId === rid || normaliseEmail(referrer.email) === normaliseEmail(reg.email);
      if (self) result.selfReferrals.push(rid);
      else {
        // The code only: see `RegistrationDoc.referredBy` for why not the id.
        patch.referredBy = { code: referrer.code, at: new Date() };
        result.credited.push(rid);
      }
    }
    if (input.utm && !reg.utm) patch.utm = input.utm;

    if (Object.keys(patch).length) await ref.update({ ...patch, updatedAt: new Date() });
  }
  return result;
}
