import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Sponsor Ticket Setup › Registration Widget.
 *
 * The same architectural wall as the exhibitor widget — an embeddable form
 * cannot sit on top of a hosted Checkout redirect, which refuses to be framed —
 * and the same refusal to print an inert snippet box.
 *
 * The sponsor version is thinner still, because there is nothing underneath it:
 * no sponsor checkout, no sponsor registration page to embed a smaller version
 * of. It is a widget for a flow that does not exist.
 */
export default async function SponsorRegistrationWidgetPage() {
  await requireOrganizer();

  return (
    <GapScreen
      title="Registration Widget"
      links={[
        <Link key="p" href="/tickets/sponsor-ticket-setup/registration-page">
          Registration Page
        </Link>,
        <Link key="e" href="/tickets/exhibitor-ticket-setup/2-8-registration-widget">
          2.8 Registration Widget (exhibitor)
        </Link>,
      ]}
      lead={
        <>
          <strong>Nothing embeddable exists, and there is no sponsor flow to embed.</strong> No
          widget, no snippet, no sponsor checkout.
        </>
      }
      whova={
        <>
          A copyable <code>&lt;script&gt;</code> or iframe snippet that renders sponsor tiers inside
          a partner or association website, so a sponsorship can be bought without leaving it.
        </>
      }
      needs={
        <>
          An embeddable form on our own origin with framing and CORS opened, and a payment step that
          survives an iframe — which hosted Checkout does not, so it would mean Stripe Elements and
          handling card fields in our own page. That is a payments decision, not a screen.
        </>
      }
      size="1–2 weeks, and only after a sponsor checkout exists at all"
      refs={
        <>
          <code>PAYMENTS.md</code> — why hosted Checkout was chosen over an embedded form. The same
          reasoning is what closes this screen.
        </>
      }
      notBuilt={[
        <li key="snippet">
          <strong>The snippet.</strong> Not shown even as a placeholder — a copy button that yields
          nothing usable is worse than an empty screen.
        </li>,
        <li key="flow">
          <strong>The flow underneath it.</strong> There is no sponsor purchase to wrap.
        </li>,
        <li key="attr">
          <strong>Attribution.</strong> Orders record a channel, not the site they came from.
        </li>,
        <li key="alt">
          <strong>What works today instead.</strong> A plain link to the public sponsorship page,
          which any partner site can carry and which needs nothing from us.
        </li>,
      ]}
    />
  );
}
