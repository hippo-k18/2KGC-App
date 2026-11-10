import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  MERCH_SEED,
  merchPickupList,
  type MerchItemDoc,
  type OrderDoc,
  type PickupRow,
} from '@kgc/shared';
import { db } from './firestore';

/**
 * Merch on the dashboard (T380): Tickets › Ticket Setup › Ticket Add-ons.
 * The website reads the same `merchItems` documents; only `active` ones show.
 */

export interface MerchItemRow extends MerchItemDoc {
  id: string;
}

export async function listMerchItems(): Promise<MerchItemRow[]> {
  const snap = await db().collection(COLLECTIONS.merchItems).where('eventId', '==', EVENT_ID).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as MerchItemDoc) }))
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
}

export async function getMerchItem(id: string): Promise<MerchItemRow | null> {
  const doc = await db().collection(COLLECTIONS.merchItems).doc(id).get();
  const data = doc.data() as MerchItemDoc | undefined;
  return data && data.eventId === EVENT_ID ? { id: doc.id, ...data } : null;
}

export async function saveMerchItem(id: string, item: Omit<MerchItemDoc, 'eventId'>): Promise<void> {
  await db()
    .collection(COLLECTIONS.merchItems)
    .doc(id)
    .set(
      {
        eventId: EVENT_ID,
        name: item.name,
        priceCents: item.priceCents,
        currency: item.currency,
        imageUrl: item.imageUrl || FieldValue.delete(),
        options: item.options ?? [],
        sizes: item.sizes ?? [],
        active: item.active,
        sort: item.sort ?? 0,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

/**
 * The two starter items (socks $15, T-shirt $35 with three designs and S to
 * XXL), switched off. Creates only the ones that are missing, so it never
 * overwrites a price or switches anything back off.
 */
export async function seedMerch(): Promise<string[]> {
  const created: string[] = [];
  for (const { id, doc } of MERCH_SEED) {
    const ref = db().collection(COLLECTIONS.merchItems).doc(id);
    try {
      await ref.create({ ...doc, eventId: EVENT_ID, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      created.push(id);
    } catch (err) {
      if ((err as { code?: number }).code !== 6) throw err; // 6 = ALREADY_EXISTS
    }
  }
  return created;
}

/** What the merch desk hands over, from every order. */
export async function merchPickup(): Promise<{ rows: PickupRow[]; orders: number }> {
  const snap = await db().collection(COLLECTIONS.orders).where('eventId', '==', EVENT_ID).get();
  const orders = snap.docs.map((d) => d.data() as OrderDoc);
  const rows = merchPickupList(orders);
  const withMerch = orders.filter(
    (o) => (o.merch?.length ?? 0) > 0 && (o.status === 'paid' || o.status === 'partially_refunded') && o.channel !== 'demo',
  ).length;
  return { rows, orders: withMerch };
}
