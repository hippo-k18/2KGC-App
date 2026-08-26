'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizer } from '@/lib/auth';
import { parseAmount, recordManualOrder } from '@/lib/manual-orders';
import { ROUTES } from '@/lib/nav';

/**
 * The one server action behind 2.6 Offline Payment and Pre-paid Exhibitors.
 *
 * Both screens post here because they are the same write. Splitting them would
 * mean two paths that both issue a ticket against unverified money, and the day
 * they diverge is the day one of them stops recording who authorised it.
 */

export interface ManualOrderState {
  ok?: boolean;
  message?: string;
  error?: string;
  claimCode?: string;
}

export async function recordManualOrderAction(
  _prev: ManualOrderState,
  form: FormData,
): Promise<ManualOrderState> {
  const actor = await requireOrganizer();

  const amountCents = parseAmount(String(form.get('amount') ?? ''));
  if (amountCents === null) {
    return { error: 'The amount must be a number like 1499 or 1499.00 — enter whole units, not cents.' };
  }

  const result = await recordManualOrder({
    email: String(form.get('email') ?? ''),
    name: String(form.get('name') ?? ''),
    ticketTypeId: String(form.get('ticketTypeId') ?? ''),
    amountCents,
    note: String(form.get('note') ?? ''),
    companyName: String(form.get('companyName') ?? '') || undefined,
    poNumber: String(form.get('poNumber') ?? '') || undefined,
    silent: form.get('silent') === 'on',
    actor,
  });

  /**
   * Revalidate every screen this touched, not just the one it was posted from.
   *
   * A manual order writes an order, a registration and a tier counter, so the
   * ledger, the attendee list and both catalogue screens are all stale the
   * moment it succeeds. Missing one of these is how an organizer records a
   * payment, looks at Attendees, does not see the person, and records it again.
   */
  revalidatePath('/tickets/exhibitor-ticket-setup/2-6-offline-payment');
  revalidatePath('/tickets/exhibitor-ticket-setup/pre-paid-exhibitors');
  revalidatePath(ROUTES.attendeeOrders);
  revalidatePath(ROUTES.ordersSummary);
  revalidatePath(ROUTES.attendees);
  revalidatePath('/tickets/orders-and-transactions/exhibitor-orders');
  revalidatePath('/tickets/orders-and-transactions/sponsor-orders');

  return result.ok
    ? { ok: true, message: result.message, claimCode: result.claimCode }
    : { error: result.error };
}
