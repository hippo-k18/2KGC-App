import type { RegistrationDoc } from '@kgc/shared';

/**
 * The badge's plain data and the ordering of several, kept apart from the hook
 * in `badge.ts` so they can be tested without React Native (T212).
 */

/** What the badge screen needs, and the exact set that is cached. */
export interface Badge {
  registrationId: string;
  /** The QR payload, and the whole of it. The reasoning is at the top of `badge.ts`. */
  qrSecret: string;
  name: string;
  ticketType: string | null;
  /**
   * The organizer's label, such as Speaker or Press. The name is copied onto the
   * registration because a phone cannot read the category list. Absent on a
   * badge cached before categories existed, so read it with `?? null`.
   */
  category?: string | null;
  status: RegistrationDoc['status'];
}

/** Without the claim code a v1 cache entry carried. */
export function stripLegacy(value: Badge & { claimCode?: unknown }): Badge {
  const { claimCode: _drop, ...rest } = value;
  return rest;
}

/**
 * The registration bought under this address first, then the ones listing it as
 * an alternate, active before cancelled or transferred, each once.
 */
export function orderBadges(primary: Badge[], alternates: Badge[]): Badge[] {
  const seen = new Set<string>();
  const rest = [...alternates].sort(
    (a, b) =>
      Number(b.status === 'active') - Number(a.status === 'active') ||
      a.name.localeCompare(b.name) ||
      a.registrationId.localeCompare(b.registrationId),
  );
  return [...primary, ...rest].filter((b) => !seen.has(b.registrationId) && Boolean(seen.add(b.registrationId)));
}
