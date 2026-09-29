import 'server-only';

import { COLLECTIONS, EVENT_ID, type RegistrationDoc } from '@kgc/shared';
import { resolveReferralCode } from '@kgc/scripts/src/lib/referrals';
import { db } from './firestore';
import { countReferrals, referralLeaderboard, type ReferrerRow } from './referrals-core';

/**
 * Attendee referrals for the dashboard. The codes are minted and the credit is
 * written by `@kgc/scripts/src/lib/referrals.ts`; this only reads.
 *
 * One `where('eventId', '==', …)` read of the registrations, counted in memory,
 * like the Attendees list: no composite index to forget.
 */

async function registrations() {
  const snap = await db().collection(COLLECTIONS.registrations).where('eventId', '==', EVENT_ID).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as RegistrationDoc) }));
}

export async function attendeeReferralLeaderboard(): Promise<{ rows: ReferrerRow[]; withCode: number }> {
  const regs = await registrations();
  return { rows: referralLeaderboard(regs), withCode: regs.filter((r) => r.referralCode).length };
}

export interface AttendeeReferral {
  code: string;
  /** Active registrations that came in through this attendee's code. */
  referred: number;
  referredBy?: { code: string; registrationId: string; name: string };
}

/** One attendee's side of it, for their record. */
export async function referralFor(rid: string, reg: RegistrationDoc): Promise<AttendeeReferral> {
  const [brought, referrer] = await Promise.all([
    // Single-field equality, served by the automatic index.
    reg.referralCode
      ? db().collection(COLLECTIONS.registrations).where('referredBy.code', '==', reg.referralCode).get()
      : null,
    reg.referredBy?.code ? resolveReferralCode(db(), reg.referredBy.code) : null,
  ]);
  const regs = (brought?.docs ?? [])
    .map((d) => d.data() as RegistrationDoc)
    .filter((r) => r.eventId === EVENT_ID);
  const by = referrer
    ? ((await db().collection(COLLECTIONS.registrations).doc(referrer.registrationId).get()).data() as
        | RegistrationDoc
        | undefined)
    : undefined;
  return {
    code: reg.referralCode ?? '',
    referred: reg.referralCode ? (countReferrals(regs).get(reg.referralCode) ?? 0) : 0,
    ...(reg.referredBy
      ? {
          referredBy: {
            code: reg.referredBy.code,
            // Looked up through `referralCodes`; the attendee's own document
            // does not hold it. Empty when the referrer has since gone.
            registrationId: referrer?.registrationId ?? '',
            name: by?.name || by?.email || '',
          },
        }
      : {}),
  };
}
