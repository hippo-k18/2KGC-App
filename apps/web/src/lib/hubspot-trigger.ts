import 'server-only';

import { COLLECTIONS, type HubspotTrigger, type OrderDoc } from '@kgc/shared';
import { queueAndKickHubspot } from '@kgc/scripts/src/lib/hubspot-sync';
import { recordError } from '@/lib/errors';
import { db } from '@/lib/firestore';

/**
 * Tell the HubSpot sync (T333) that these registrations changed: a paid order,
 * a refund, a chargeback. Called after the change has been written.
 *
 * Awaits only the queue write; the send to HubSpot runs on its own. When the
 * sync is off it reads one settings document and returns. Never throws, so a
 * HubSpot outage or a bad token cannot fail a sale or a refund, and cannot
 * change what the webhook answers Stripe.
 *
 * A second run for the same order (the webhook and `/checkout/return` at once,
 * or a Stripe redelivery) queues the same documents again, which is harmless:
 * the queue is keyed by registration id.
 */
export async function kickHubspot(
  registrationIds: readonly (string | null | undefined)[],
  trigger: HubspotTrigger,
): Promise<void> {
  try {
    const ids = [...new Set(registrationIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return;
    await queueAndKickHubspot(db(), ids, trigger, (what, err) => void recordError(`hubspot.sync: ${what}`, err));
  } catch (err) {
    await recordError('hubspot.trigger', err);
  }
}

/**
 * The same, for every registration an order lists (seat one and the rest, and
 * badges it only added an extra to), plus `also`: the holder of a transferred
 * seat, say, whose registration the order does not name.
 */
export async function kickHubspotForOrder(
  orderId: string,
  also: readonly (string | null | undefined)[],
  trigger: HubspotTrigger,
): Promise<void> {
  let listed: string[] = [];
  try {
    const order = (await db().collection(COLLECTIONS.orders).doc(orderId).get()).data() as OrderDoc | undefined;
    listed = [...(order?.registrationIds ?? []), ...(order?.extraRegistrationIds ?? [])];
  } catch (err) {
    await recordError('hubspot.trigger', err, { path: 'orders', id: orderId });
  }
  await kickHubspot([...listed, ...also], trigger);
}
