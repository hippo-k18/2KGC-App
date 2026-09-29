import 'server-only';

import { COLLECTIONS, EVENT_ID, type RegistrationDoc } from '@kgc/shared';
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
    db().collection(COLLECTIONS.registrations).where('referredBy.registrationId', '==', rid).get(),
    reg.referredBy?.registrationId
      ? db().collection(COLLECTIONS.registrations).doc(reg.referredBy.registrationId).get()
      : null,
  ]);
  const regs = brought.docs
    .map((d) => ({ id: d.id, ...(d.data() as RegistrationDoc) }))
    .filter((r) => r.eventId === EVENT_ID);
  const by = referrer?.data() as RegistrationDoc | undefined;
  return {
    code: reg.referralCode ?? '',
    referred: countReferrals(regs).get(rid) ?? 0,
    ...(reg.referredBy
      ? {
          referredBy: {
            code: reg.referredBy.code,
            registrationId: reg.referredBy.registrationId,
            name: by?.name || by?.email || '',
          },
        }
      : {}),
  };
}
