import 'server-only';

import {
  COLLECTIONS,
  EVENT_ID,
  cleanMerchLines,
  toMerchItem,
  type MerchItem,
  type MerchCartDoc,
  type MerchItemDoc,
  type MerchLine,
  type OrderDoc,
} from '@kgc/shared';
import { normaliseEmail } from '@kgc/scripts/src/lib/ids';
import { db } from './firestore';

/**
 * Merch on the website (T380). The items live in `merchItems`, managed on the
 * dashboard; the pure cart rules are `@kgc/shared/merch`.
 */

async function allItems(): Promise<{ id: string; doc: MerchItemDoc }[]> {
  const snap = await db().collection(COLLECTIONS.merchItems).where('eventId', '==', EVENT_ID).get();
  return snap.docs
    .map((d) => ({ id: d.id, doc: d.data() as MerchItemDoc }))
    .sort((a, b) => (a.doc.sort ?? 0) - (b.doc.sort ?? 0) || a.doc.name.localeCompare(b.doc.name));
}

/**
 * The items on sale now. Empty when every item is off, which hides merch from
 * checkout and `/tickets/merch` alike. A read failure is also empty: merch is
 * never a reason the ticket checkout fails to render.
 */
export async function activeMerch(): Promise<MerchItem[]> {
  try {
    return (await allItems())
      .filter(({ doc }) => doc.active === true && Number.isInteger(doc.priceCents) && doc.priceCents > 0)
      .map(({ id, doc }) => toMerchItem(id, doc));
  } catch (err) {
    console.error('[merch] could not read merch items', err);
    return [];
  }
}

/**
 * The cart a session points at with `merchRef` (T387), as priced and named at
 * checkout. Empty when the session has no merch. Throws when the ref is there
 * but the cart cannot be read, so the webhook answers 5xx and Stripe
 * redelivers rather than fulfilling without the merch.
 */
export async function merchFromMetadata(metadata: Record<string, string> | null | undefined): Promise<MerchLine[]> {
  const ref = metadata?.merchRef?.trim();
  if (!ref) return [];
  const snap = await db().collection(COLLECTIONS.merchCarts).doc(ref).get();
  const cart = snap.data() as MerchCartDoc | undefined;
  if (!cart || cart.eventId !== EVENT_ID) {
    console.error('[merch] no merch cart for', ref);
    return [];
  }
  return cleanMerchLines(cart.lines);
}

/**
 * Everything this person bought as merch: on a ticket order they paid for, or
 * on its own against their ticket. For the order page.
 */
export async function merchBoughtBy(email: string, registrationId: string): Promise<MerchLine[]> {
  try {
    const orders = db().collection(COLLECTIONS.orders);
    const [byEmail, byHolder] = await Promise.all([
      orders.where('email', '==', normaliseEmail(email)).get(),
      orders.where('holderRegistrationId', '==', registrationId).get(),
    ]);
    const seen = new Set<string>();
    const lines: MerchLine[] = [];
    for (const d of [...byEmail.docs, ...byHolder.docs]) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const o = d.data() as OrderDoc;
      if (o.eventId !== EVENT_ID || (o.status !== 'paid' && o.status !== 'partially_refunded')) continue;
      lines.push(...(o.merch ?? []));
    }
    return lines;
  } catch (err) {
    console.error('[merch] could not read merch for', registrationId, err);
    return [];
  }
}
