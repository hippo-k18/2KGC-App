import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › 2.6 Offline Payment.
 *
 * ── The closest thing to built on the exhibitor side ────────────────────────
 *
 * Exhibitors pay by invoice, and invoicing is one of the two payment channels
 * this project actually has: an order with `channel: 'invoice'` sits `pending`
 * until it is paid, `Attendee Orders` can mark it paid out of band, and that
 * action stamps `markedPaidBy` so the row reads &ldquo;paid out of band&rdquo;
 * rather than pretending money arrived through Stripe.
 *
 * None of that is exhibitor-scoped, and — the honest part — nothing in this
 * dashboard *raises* an invoice; invoices come from the website&rsquo;s
 * checkout. So this screen points at the mechanism that exists instead of
 * offering a button that would only look like it.
 */
export default async function ExhibitorOfflinePaymentPage() {
  await requireOrganizer();

  return (
    <GapScreen
      title="2.6 Offline Payment"
      links={[
        <Link key="o" href={ROUTES.attendeeOrders}>
          Attendee Orders
        </Link>,
        <Link key="s" href={ROUTES.ordersSummary}>
          Summary
        </Link>,
      ]}
      lead={
        <>
          <strong>Invoicing exists; an exhibitor-scoped version of it does not.</strong> Orders can
          already be raised as invoices and marked paid out of band from{' '}
          <Link href={ROUTES.attendeeOrders}>Attendee Orders</Link> — but there is no exhibitor
          catalogue to invoice for, and no invoice can be raised from this dashboard.
        </>
      }
      whova={
        <>
          A per-audience switch that offers cheque, wire or purchase order at registration, holds
          the registration as unpaid, generates an invoice PDF with the event&rsquo;s remittance
          details, chases it, and lets an organizer mark it paid on receipt.
        </>
      }
      needs={
        <>
          Two things, and only one of them is small. The small one is scoping: mark-paid and the
          outstanding-invoice figures on <Link href={ROUTES.ordersSummary}>Summary</Link> already
          work, they simply have no audience to filter by. The larger one is raising an invoice from
          here at all — today a Stripe invoice is created by the website&rsquo;s checkout, and an
          exhibitor deal is agreed in an email thread, not on a purchase page.
        </>
      }
      size="2–3 days once an exhibitor catalogue exists; the invoice-raising form is the bulk of it"
      refs={
        <>
          <code>apps/organizer/src/lib/commerce.ts</code> — <code>channel</code>,{' '}
          <code>markedPaidBy</code> and why <code>refundable</code> excludes invoices (a credit
          note is a different Stripe API, not a refund).
        </>
      }
      notBuilt={[
        <li key="raise">
          <strong>Raising an invoice from the dashboard.</strong> The action an organizer would come
          to this screen for. It does not exist for any audience.
        </li>,
        <li key="po">
          <strong>Purchase-order capture.</strong> <code>OrderDoc.poNumber</code> exists and is
          displayed, but nothing collects it — it can only arrive from a script.
        </li>,
        <li key="chase">
          <strong>Chasing.</strong> No reminder schedule, no ageing view. Outstanding invoices are a
          single total on Summary.
        </li>,
        <li key="credit">
          <strong>Credit notes.</strong> The invoice equivalent of a refund, deliberately out of
          scope — it is separate accounting, not a smaller refund button.
        </li>,
      ]}
    />
  );
}
