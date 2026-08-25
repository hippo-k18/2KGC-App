import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/nav';

/**
 * Pay › Order Details.
 *
 * Whova splits ticket orders across two tabs — Tickets › Orders and
 * Transactions, and Pay › Order Details — because in their product those are
 * different things: what your attendees bought, and what *you* owe Whova for
 * the platform. We have no platform bill, so the second has no content of its
 * own and would be an empty screen next to a full one.
 *
 * Redirecting rather than duplicating the table. Two screens showing the same
 * orders is two screens that eventually disagree about a filter.
 */
export default async function PayOrderDetailsPage() {
  redirect(ROUTES.attendeeOrders);
}
