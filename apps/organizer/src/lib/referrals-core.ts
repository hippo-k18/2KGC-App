import type { RegistrationDoc } from '@kgc/shared';

/**
 * Counting attendee referrals: who brought whom, from `referredBy.code` on each
 * registration. Pure, so it is tested without Firestore; `referrals.ts` fetches.
 *
 * The join is on the code, not a registration id: a referred attendee's own
 * document carries only the code (see `RegistrationDoc.referredBy`), and a
 * code belongs to exactly one registration, the one whose `referralCode` it is.
 *
 * A referral counts while the ticket it brought is active. A cancelled or
 * refunded ticket is a person who is not coming, and a leaderboard that kept
 * them would reward the refund.
 */

export interface ReferrerRow {
  registrationId: string;
  name: string;
  email: string;
  code: string;
  /** Active registrations that came in through this person's code. */
  referred: number;
}

type Reg = Pick<RegistrationDoc, 'name' | 'email' | 'status' | 'referralCode' | 'referredBy'> & { id: string };

/** Active referred registrations per referral code. */
export function countReferrals(regs: Pick<Reg, 'status' | 'referredBy'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of regs) {
    const code = r.referredBy?.code;
    if (!code || r.status !== 'active') continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
}

/** Everyone who has brought at least one attendee, most first, then by name. */
export function referralLeaderboard(regs: Reg[]): ReferrerRow[] {
  const counts = countReferrals(regs);
  const owners = new Map(regs.filter((r) => r.referralCode).map((r) => [r.referralCode!, r]));
  return [...counts.entries()]
    .flatMap(([code, referred]) => {
      const r = owners.get(code);
      // A code whose owner is gone has nobody to credit.
      return r ? [{ registrationId: r.id, name: r.name ?? '', email: r.email, code, referred }] : [];
    })
    .sort((a, b) => b.referred - a.referred || (a.name || a.email).localeCompare(b.name || b.email));
}
