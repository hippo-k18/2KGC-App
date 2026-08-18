import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import { formatPrice, TIERS, tierById, type TicketId } from '@/lib/tickets';
import { stripeEnabled } from '@/lib/stripe';
import { CheckoutForm } from './checkout-form';

export const metadata: Metadata = {
  title: 'Tickets',
  description:
    'All Access, Main Conference, Workshops and Virtual tickets for the Knowledge Graph Conference 2027.',
};

/**
 * `stripeEnabled()` reads an environment variable, so this page cannot be
 * statically prerendered — a build-time snapshot would bake in whichever mode
 * the build machine happened to be in.
 */
export const dynamic = 'force-dynamic';

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  const params = await searchParams;
  const preselected = (tierById(params.tier ?? '')?.id ?? 'all-access') as TicketId;

  return (
    <>
      <section>
        <div className="wrap">
          <p className="eyebrow">{SITE.datesLong} · {SITE.venue}</p>
          <h1>Tickets</h1>
          <p className="lede">
            One price, no early-bird games. Every in-person ticket includes the community happy hour
            and the evening networking events, and every ticket — including virtual — includes the
            KGC app for the whole week.
          </p>

          {params.cancelled && (
            <p className="notice warn" style={{ marginTop: 20 }}>
              Checkout was cancelled and nothing was charged. Your details are below if you want to
              try again.
            </p>
          )}

          <div className="tiers" style={{ marginTop: 36 }}>
            {TIERS.map((t) => (
              <div key={t.id} className={`tier${t.featured ? ' featured' : ''}`}>
                {t.featured && <span className="badge">Most popular</span>}
                <h2>{t.name}</h2>
                <p className="muted" style={{ fontSize: '0.9rem', margin: 0 }}>
                  {t.tagline}
                </p>
                <div className="price">
                  {formatPrice(t.priceCents)} <small>per person</small>
                </div>
                <ul>
                  {t.includes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <Link
                  href={`/tickets?tier=${t.id}#buy`}
                  className={`btn btn-block ${t.featured ? 'btn-primary' : 'btn-outline'}`}
                >
                  Choose {t.name}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="tint">
        <div className="wrap" style={{ display: 'grid', gap: 40, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
          <div>
            <p className="eyebrow">How it works</p>
            <h2>Buy once, and your ticket follows you</h2>
            <ol className="steps" style={{ marginTop: 22 }}>
              <li>
                <strong>Register here</strong>
                Pick a tier and give us the attendee’s name and email address.
              </li>
              <li>
                <strong>Keep the claim code</strong>
                The confirmation screen shows a six-character code. It is the fallback door into your
                ticket if you ever sign in from a different address.
              </li>
              <li>
                <strong>Install the KGC app</strong>
                Sign in with the same email address and your ticket is already there — schedule,
                messages, contacts and your badge QR.
              </li>
              <li>
                <strong>Scan in at the door</strong>
                Your badge QR carries a random secret, not your identity. Someone photographing it
                learns nothing about who you are.
              </li>
            </ol>

            <h3 style={{ marginTop: 34 }}>Questions people actually ask</h3>
            <p>
              <strong>Can I transfer my ticket?</strong> Yes, up to a week before the conference —
              mail <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> with the new
              attendee’s details and we will move the registration rather than issue a second one.
            </p>
            <p>
              <strong>Is there a student rate?</strong> Yes. Write to us from your institutional
              address before you buy.
            </p>
            <p>
              <strong>Do virtual tickets get recordings?</strong> Yes — every session, on demand, for
              at least a month afterwards.
            </p>
            <p>
              <strong>What if I use a different email at work?</strong> Sign in with either and use
              the claim code; we can attach alternate addresses to one registration.
            </p>
          </div>

          <CheckoutForm initialTier={preselected} stripeReady={stripeEnabled()} />
        </div>
      </section>
    </>
  );
}
