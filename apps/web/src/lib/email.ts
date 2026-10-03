import 'server-only';

import {
  emailEnabled as sharedEmailEnabled,
  sendInvoiceRaised as sharedSendInvoiceRaised,
  sendPurchaseConfirmation as sharedSendPurchaseConfirmation,
  sendRefundConfirmation as sharedSendRefundConfirmation,
  sendTicketWithdrawn as sharedSendTicketWithdrawn,
  type InvoiceEmailInput,
  type PurchaseEmailInput,
  type RefundEmailInput,
  type SendOutcome,
  type TicketWithdrawnInput,
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
 * **A failed send never fails its caller.** Every function swallows its own
 * errors and none of them rejects. The callers are the Stripe webhook and the
 * invoice action; a throw in the webhook becomes a non-2xx, a non-2xx makes
 * Stripe retry forever, and Stripe eventually disables the endpoint — which
 * would take *fulfilment* down because a receipt bounced.
 *
 * They return `SendOutcome` so a caller with a screen behind it can report
 * what happened rather than guess. Nothing in this app has one: the webhook
 * and the invoice action ignore the value, which is correct, and must go on
 * ignoring it.
 */

export type {
  InvoiceEmailInput,
  PurchaseEmailInput,
  RefundEmailInput,
  SendOutcome,
  TicketWithdrawnInput,
};

export function emailEnabled(): boolean {
  return sharedEmailEnabled();
}

export function sendPurchaseConfirmation(input: PurchaseEmailInput): Promise<SendOutcome> {
  return sharedSendPurchaseConfirmation(db(), input);
}

export function sendInvoiceRaised(input: InvoiceEmailInput): Promise<SendOutcome> {
  return sharedSendInvoiceRaised(db(), input);
}

export function sendRefundConfirmation(input: RefundEmailInput): Promise<SendOutcome> {
  return sharedSendRefundConfirmation(db(), input);
}

export function sendTicketWithdrawn(input: TicketWithdrawnInput): Promise<SendOutcome> {
  return sharedSendTicketWithdrawn(db(), input);
}
