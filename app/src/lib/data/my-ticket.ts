import {
  myAddress,
  registrationByAltEmail,
  registrationByEmail,
} from '@/lib/data/registrations';
import { ticketAnswer, type TicketAnswer } from '@/lib/data/session-seats-core';
import { useAuth } from '@/lib/auth/auth-provider';
import { useCollection } from '@/lib/data/use-collection';
import { getDb } from '@/lib/firebase/client';

import type { RegistrationDoc } from '@kgc/shared';

/**
 * Which ticket the signed-in attendee holds.
 *
 * Lifted out of `useSessionSeat`, which had it inline, the day a second feature
 * needed the same answer. `registrations.ts` opens with the argument for why
 * this lookup is spelled once — three spellings are three chances to disagree,
 * and when they disagree the symptom is somebody told their own ticket does not
 * cover something it does cover. That argument applies to the *reduction* as
 * much as to the queries, so both live here now and both callers get the same
 * three-way answer out of `ticketAnswer`.
 *
 * `enabled` is how a caller avoids paying for a read it does not need: a
 * session with no ticket restriction anywhere on it needs no registration at
 * all, and an unrestricted video is the common case.
 *
 * The three outcomes and what each one means for a screen are documented on
 * `ticketAnswer`. The short version: never bar anybody on `known === false`.
 * A screen that locks somebody out because its own lookup never ran is worse
 * than one that asks and is told no, and the rules answer either way.
 */
export function useMyTicket(enabled = true): TicketAnswer {
  const { user } = useAuth();
  // Folded, because the account carries whatever address it was created with
  // and registrations store a lowercased one.
  const address = myAddress(user?.email);

  const toTicketType = (_id: string, d: RegistrationDoc) => d.ticketType ?? null;

  const primary = useCollection<string | null>(
    () => (enabled && address ? registrationByEmail(getDb(), address) : null),
    [enabled, address],
    toTicketType,
  );

  /**
   * The same address as an alternate. A ticket bought on a work address and
   * signed in on a personal one is the ordinary case. Opened only once the
   * primary has come back empty, so nobody pays for two reads to learn one
   * thing.
   */
  const primaryEmpty = !primary.loading && !primary.error && primary.data?.length === 0;
  const alternate = useCollection<string | null>(
    () =>
      enabled && address && primaryEmpty ? registrationByAltEmail(getDb(), address) : null,
    [enabled, address, primaryEmpty],
    toTicketType,
  );

  if (!enabled) return { ticketType: null, known: false, pending: false };

  return ticketAnswer(
    address,
    { rows: primary.data, loading: primary.loading, error: primary.error },
    { rows: alternate.data, loading: alternate.loading, error: alternate.error },
  );
}
