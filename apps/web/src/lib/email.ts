import 'server-only';

import {
  emailEnabled as sharedEmailEnabled,
  sendInvoiceRaised as sharedSendInvoiceRaised,
  sendPurchaseConfirmation as sharedSendPurchaseConfirmation,
  sendRefundConfirmation as sharedSendRefundConfirmation,
  type InvoiceEmailInput,
  type PurchaseEmailInput,
  type RefundEmailInput,
} from '@kgc/scripts/src/lib/email';
import { db } from './firestore';

/**
 * Transactional email, bound to this app's Firestore handle.
 *
 * The templates and the sending itself live in `@kgc/scripts/src/lib/email`,
 * because the organizer dashboard sends the *same* confirmation when it accepts
 * a purchase order out of band — and two copies of a receipt template is two
 * receipts that eventually say different things about the same purchase.
 *
 * This file exists only so call sites in the website do not each have to pass
 * `db()`. Everything below still holds:
 *
 * **A failed send never fails its caller.** Every function is `Promise<void>`
 * and swallows its own errors. The callers are the Stripe webhook and the
 * invoice action; a throw in the webhook becomes a non-2xx, a non-2xx makes
 * Stripe retry forever, and Stripe eventually disables the endpoint — which
 * would take *fulfilment* down because a receipt bounced.
 */

export type { InvoiceEmailInput, PurchaseEmailInput, RefundEmailInput };

export function emailEnabled(): boolean {
  return sharedEmailEnabled();
}

export function sendPurchaseConfirmation(input: PurchaseEmailInput): Promise<void> {
  return sharedSendPurchaseConfirmation(db(), input);
}

export function sendInvoiceRaised(input: InvoiceEmailInput): Promise<void> {
  return sharedSendInvoiceRaised(db(), input);
}

export function sendRefundConfirmation(input: RefundEmailInput): Promise<void> {
  return sharedSendRefundConfirmation(db(), input);
}
