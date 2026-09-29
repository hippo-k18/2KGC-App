import type { RegistrationDoc } from '@kgc/shared';

/**
 * Counting attendee referrals: who brought whom, from `referredBy` on each
 * registration. Pure, so it is tested without Firestore; `referrals.ts` fetches.
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
  /** Active registrations that name this person as their referrer. */
  referred: number;
}

type Reg = Pick<RegistrationDoc, 'name' | 'email' | 'status' | 'referralCode' | 'referredBy'> & { id: string };

export function countReferrals(regs: Reg[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of regs) {
    const by = r.referredBy?.registrationId;
    if (!by || r.status !== 'active') continue;
    counts.set(by, (counts.get(by) ?? 0) + 1);
  }
  return counts;
}

/** Everyone who has brought at least one attendee, most first, then by name. */
export function referralLeaderboard(regs: Reg[]): ReferrerRow[] {
  const counts = countReferrals(regs);
  const byId = new Map(regs.map((r) => [r.id, r]));
  return [...counts.entries()]
    .map(([id, referred]) => {
      const r = byId.get(id);
      return {
        registrationId: id,
        name: r?.name ?? '',
        email: r?.email ?? '',
        code: r?.referralCode ?? '',
        referred,
      };
    })
    .sort((a, b) => b.referred - a.referred || (a.name || a.email).localeCompare(b.name || b.email));
}
