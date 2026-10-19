import 'server-only';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { contactId } from '@kgc/scripts/src/lib/ids';
import { db } from './firestore';
import type { DeliveryProblem } from './resend-webhook-core';

/**
 * Write a bounce or a spam complaint where the next send will see it (T258 #9).
 *
 * Three places, each for a different reader:
 *   - `contacts/{id}`: `audienceFor()` drops `bouncedAt` and `complainedAt`
 *     from every campaign, so a dead address is not mailed again.
 *   - `registrations` for that address: the attendee list shows "bounced", so
 *     the desk can answer "I never got my ticket" with "it bounced".
 *   - the `emailLog` row Resend's id names, so the log stops saying only `sent`.
 *
 * Only documents that exist are touched: a bounce never creates a contact, and
 * the first time is kept, so a replayed webhook changes nothing.
 */
export async function recordDeliveryProblem(problem: DeliveryProblem): Promise<void> {
  const field = problem.kind === 'bounced' ? 'bouncedAt' : 'complainedAt';
  const store = db();

  for (const email of problem.emails) {
    const contact = store.collection(COLLECTIONS.contacts).doc(contactId(email));
    const snap = await contact.get();
    if (snap.exists && !snap.get(field)) await contact.update({ [field]: problem.at, updatedAt: new Date() });

    // One equality filter, so the automatic single-field index serves it.
    const regs = await store.collection(COLLECTIONS.registrations).where('email', '==', email).get();
    for (const r of regs.docs) {
      if (r.get('eventId') !== EVENT_ID || r.get(field)) continue;
      await r.ref.update({ [field]: problem.at });
    }
  }

  if (problem.emailId) {
    const rows = await store.collection(COLLECTIONS.emailLog).where('providerId', '==', problem.emailId).get();
    for (const row of rows.docs) {
      if (!row.get(field)) await row.ref.update({ [field]: problem.at });
    }
  }
}
