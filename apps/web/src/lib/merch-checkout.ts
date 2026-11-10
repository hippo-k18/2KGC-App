import 'server-only';

import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EVENT_ID,
  MERCH_PICKUP_NOTE,
  merchLineLabel,
  merchTotalCents,
  priceMerchCart,
  type MerchLine,
} from '@kgc/shared';
import { db } from './firestore';
import { activeMerch } from './merch';

/** What a refusal hands back to a form: the same shape as `CheckoutState`. */
export interface MerchRefusal {
  error: string;
}

/**
 * The merch a form posted, priced, or the refusal to show. Shared with the
 * merch-only checkout on `/tickets/merch`.
 */
export async function merchFromForm(form: FormData, currency: string): Promise<MerchLine[] | MerchRefusal> {
  const posted = form.getAll('merchLine').map((v) => String(v));
  if (!posted.some((p) => Number(p.split('|')[3]) > 0)) return [];
  const items = await activeMerch();
  const cart = priceMerchCart(posted, items);
  if (!cart.ok) return { error: cart.error };
  if (cart.lines.some((l) => items.find((i) => i.id === l.itemId)?.currency !== currency)) {
    return { error: 'Merch and tickets must be in the same currency.' };
  }
  return cart.lines;
}

/**
 * A merch line as Stripe sees it. Never the ticket's product, so a discount
 * code limited to a ticket cannot come off it.
 */
export function merchLineItem(line: MerchLine, currency: string) {
  return {
    quantity: line.quantity,
    price_data: {
      currency,
      unit_amount: line.unitPriceCents,
      product_data: {
        name: `KGC 2027 merch: ${merchLineLabel(line)}`,
        description: MERCH_PICKUP_NOTE,
        // Stripe's "General - Tangible Goods".
        tax_code: 'txcd_99999999',
      },
    },
  };
}

/**
 * Write the priced cart where the webhook will find it, and return its ref
 * (T387). Before the redirect, like a group's seat list: the cart no longer
 * travels in metadata, because a long item or design name can take one value
 * past Stripe's 500 characters. Throws on failure; callers refuse the checkout
 * then, before any money moves.
 */
export async function recordMerchCart(merch: MerchLine[]): Promise<string> {
  const ref = `mc_${randomBytes(12).toString('hex')}`;
  await db()
    .collection(COLLECTIONS.merchCarts)
    .doc(ref)
    .create({ eventId: EVENT_ID, lines: merch, merchCents: merchTotalCents(merch), createdAt: FieldValue.serverTimestamp() });
  return ref;
}

/**
 * Session metadata for a merch cart: a 27-character ref and the sum, whatever
 * the cart holds. Nothing when there is no merch, so a ticket-only session is
 * exactly as it was.
 */
export function merchMetadata(ref: string | undefined, merch: MerchLine[]): Record<string, string> {
  if (!ref || merch.length === 0) return {};
  return { merchRef: ref, merchCents: String(merchTotalCents(merch)) };
}

/** The buyer's sentence when a cart cannot be saved: nothing has been charged. */
export const MERCH_SAVE_FAILED =
  'We could not save your merch order, so we have not taken you to payment. Nothing was charged. Please try again.';
