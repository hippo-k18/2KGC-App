import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS, EVENT_ID, type StripeIgnoredDoc } from '@kgc/shared';
import { db } from './firestore';

/**
 * Note a Stripe event that is not about a ticket, and move on.
 *
 * The KGC Stripe account is used for more than ticketing, so most of what the
 * webhook receives may be sponsorships, Payment Links or invoices raised by
 * hand. None of it is an error. It used to go to `auditLog` as a warning
 * ("Payment taken outside the website"), where a normal sponsorship payment
 * looked like something had gone wrong and pushed real warnings off Tools ›
 * Report (T142). It now goes to its own quiet collection, which Transaction
 * History lists as "Stripe payments not from ticketing (ignored)".
 *
 * Keyed by event type and Stripe object, so Stripe's redeliveries rewrite one
 * row. Never throws: a log line must not fail a webhook.
 */
export async function noteIgnoredStripe(
  entry: Omit<StripeIgnoredDoc, 'eventId' | 'at'>,
): Promise<void> {
  const defined = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined && v !== ''));
  try {
    await db()
      .collection(COLLECTIONS.stripeIgnored)
      .doc(`${entry.eventType}_${entry.stripeId}`.replace(/\//g, '_'))
      .set({ ...defined, eventId: EVENT_ID, at: FieldValue.serverTimestamp() });
  } catch (err) {
    console.error('[stripe] could not note an ignored event', entry.eventType, entry.stripeId, err);
  }
}
