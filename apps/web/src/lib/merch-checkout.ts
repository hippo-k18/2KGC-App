import 'server-only';

import {
  MERCH_PICKUP_NOTE,
  encodeMerchMetadata,
  merchLineLabel,
  merchTotalCents,
  priceMerchCart,
  type MerchLine,
} from '@kgc/shared';
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

/** Session metadata for a merch cart: the lines and their sum, or nothing. */
export function merchMetadata(merch: MerchLine[]): Record<string, string> {
  if (merch.length === 0) return {};
  return { merch: encodeMerchMetadata(merch), merchCents: String(merchTotalCents(merch)) };
}
