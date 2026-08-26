import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › Pre-Paid Exhibitors.
 *
 * The screen for exhibitors whose money never touched the platform — a
 * sponsorship signed last year that included a booth, a partner deal, a
 * contra arrangement. They must register without paying, and must not be
 * counted as revenue.
 *
 * The nearest thing this project has is a 100% Stripe promotion code, and it is
 * not near enough to imply: it is account-wide, anyone who learns the string can
 * use it, and it produces a $0 order that looks like a discounted sale rather
 * than a pre-paid one.
 */
export default async function PrePaidExhibitorsPage() {
  await requireOrganizer();

  return (
    <GapScreen
      title="Pre-Paid Exhibitors"
      links={[
        <Link key="e" href="/content/exhibitor-center/exhibitor-manager">
          Exhibitor Manager
        </Link>,
        <Link key="d" href={ROUTES.discountCodes}>
          Discount Codes
        </Link>,
      ]}
      lead={
        <>
          <strong>There is no pre-paid roster and no way to register without paying.</strong> Every
          registration in this system is produced by fulfilling an order.
        </>
      }
      whova={
        <>
          An uploaded list of companies and contacts that have already paid outside the platform.
          Each is given a personal registration link that skips payment entirely, and their
          registrations are excluded from ticket revenue while still counting toward booth
          allocation.
        </>
      }
      needs={
        <>
          An invited-roster collection keyed by email with a single-use token, a registration path
          that bypasses Checkout, and a channel value that keeps these out of revenue.{' '}
          <code>OrderDoc.channel</code> already carries <code>demo</code> for exactly that
          reason — test purchases are excluded from every money figure — so the accounting pattern
          is established even though the entry path is not.
        </>
      }
      size="3–4 days, most of it the tokenised invite link and its single-use guarantee"
      refs={
        <>
          <code>apps/organizer/src/lib/commerce.ts</code> — <code>salesSummary()</code>, which shows
          how a channel is excluded from revenue and counted separately instead.
        </>
      }
      notBuilt={[
        <li key="roster">
          <strong>The roster.</strong> No upload, no list, no per-company contact record.
        </li>,
        <li key="link">
          <strong>Bypass links.</strong> An HMAC capability token like the one on the order
          confirmation page would be the right shape; none is minted for this.
        </li>,
        <li key="hidden">
          <strong>A hidden $0 tier as a workaround.</strong> <code>visible: false</code> keeps a
          tier out of the catalogue while it stays purchasable by direct link — but the link is
          guessable and shareable, so it is a convenience, not access control. It is not offered
          here for that reason.
        </li>,
        <li key="revenue">
          <strong>Keeping them out of revenue.</strong> A $0 order would count as a paid order in
          every figure on Summary, which is wrong in a way an organizer would not spot.
        </li>,
      ]}
    />
  );
}
