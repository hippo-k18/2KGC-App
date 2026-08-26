import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › 2.8 Registration Widget.
 *
 * ── The thinnest screen in this group, and it should say so ─────────────────
 *
 * A registration widget is a snippet a partner pastes into their own site,
 * which then registers exhibitors without leaving that site. It presupposes an
 * embeddable, origin-agnostic registration form. There is none: registration
 * here means a Stripe hosted Checkout redirect, which by design takes the buyer
 * to Stripe&rsquo;s domain and refuses to be framed.
 *
 * So this is not &ldquo;a widget we have not got around to&rdquo;. It is a
 * different purchase architecture, and pretending otherwise with a copyable
 * snippet box that produces nothing would be the exact failure this dashboard
 * is written to avoid.
 */
export default async function ExhibitorRegistrationWidgetPage() {
  await requireOrganizer();

  return (
    <GapScreen
      title="2.8 Registration Widget"
      links={[
        <Link key="p" href="/tickets/exhibitor-ticket-setup/2-7-registration-page">
          2.7 Registration Page
        </Link>,
        <Link key="a" href="/tickets/ticket-setup/1-5-registration-widgets">
          1.5 Registration Widgets (attendee)
        </Link>,
      ]}
      lead={
        <>
          <strong>Nothing embeddable exists.</strong> There is no widget, no snippet and no form
          that can run on another origin — and no exhibitor registration for one to wrap.
        </>
      }
      whova={
        <>
          A copyable <code>&lt;script&gt;</code> or iframe snippet that renders the audience&rsquo;s
          ticket list inside a partner or association website, with a matching button-only variant,
          and attribution so the organizer can see which site sent the registration.
        </>
      }
      needs={
        <>
          An embeddable form served from our own origin with framing and CORS deliberately opened,
          plus a payment step that survives being in an iframe — Stripe hosted Checkout does not, so
          this would mean Stripe Elements and taking card data handling into our own page, with the
          compliance that implies. That is a larger decision than a screen.
        </>
      }
      size="1–2 weeks, and it changes the payment architecture rather than extending it"
      refs={
        <>
          <code>PAYMENTS.md</code> — why hosted Checkout was chosen over an embedded form in the
          first place. The reasoning applies directly to this screen.
        </>
      }
      notBuilt={[
        <li key="snippet">
          <strong>The snippet.</strong> Not shown, not even as a placeholder: a copyable box that
          renders nothing on a partner site is worse than an empty screen.
        </li>,
        <li key="embed">
          <strong>An embeddable checkout.</strong> Hosted Checkout redirects by design and blocks
          framing.
        </li>,
        <li key="attr">
          <strong>Referrer attribution.</strong> <code>OrderDoc</code> records the channel, not the
          site an order arrived from.
        </li>,
        <li key="alt">
          <strong>The honest substitute.</strong> A plain link to the public tickets page works
          today, in any partner site, and needs nothing from us.
        </li>,
      ]}
    />
  );
}
