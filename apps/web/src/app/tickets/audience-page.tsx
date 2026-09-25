import Link from 'next/link';
import type { ReactNode } from 'react';
import type { TicketAudience } from '@kgc/shared';
import { tiersOrNull } from '@/lib/catalogue';
import { siteEvent } from '@/lib/data';
import { SITE } from '@/lib/site';
import type { TicketId } from '@/lib/tickets';
import { demoCheckoutAllowed } from '@/lib/demo-checkout';
import { stripeEnabled } from '@/lib/stripe';
import { activeForm } from '@/lib/question-forms';
import { CheckoutForm } from './checkout-form';
import { TierCard } from './tier-card';

/**
 * The exhibitor and sponsor registration pages.
 *
 * Whova ships three parallel registration flows — attendee, exhibitor, sponsor
 * — and they are the same purchase over a different slice of one price list
 * with a different conversation around it. `TicketTypeDoc.audience` already
 * models the slice, so this is one component the two non-attendee pages share
 * rather than two more copies of `/tickets` that would drift apart the first
 * time the checkout changed.
 *
 * ── Why these pages had to exist before the dashboard screens meant anything ─
 *
 * Nine screens in the organizer dashboard describe exhibitor and sponsor
 * ticketing, and until now every one of them was true but useless: the
 * catalogue read `ticketTypes` correctly, and nothing anywhere would sell what
 * it listed, because `listTiers()` filtered to attendees unconditionally. An
 * organizer could price a booth and no buyer could reach it. The gap was never
 * the dashboard; it was the missing half of the pair.
 *
 * ── Deliberately plainer than `/tickets` ────────────────────────────────────
 *
 * This page keeps a short navy heading band and a column of reasons beside the
 * form; `/tickets` has neither, because an attendee lands there to compare
 * prices. An exhibitor arrives from a sales conversation already knowing what
 * they want; the page's job is to take the money without making them read.
 * Copying the attendee page's furniture here would be mimicry rather than
 * design.
 */

export interface AudiencePageCopy {
  audience: TicketAudience;
  /** `Exhibit at KGC 2027` — the h1. */
  heading: string;
  /** One paragraph under the heading. */
  lede: ReactNode;
  /** Lower-case singular, for prose: "exhibitor". */
  noun: string;
  /** Three to five points, shown beside the form. Why buy this, not what is in it. */
  points: { title: string; body: ReactNode }[];
  /** What to say when this audience's slice of the catalogue is empty. */
  emptyHint: ReactNode;
}

export async function AudienceTicketsPage({
  copy,
  searchParams,
}: {
  copy: AudiencePageCopy;
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  const ev = await siteEvent();
  const params = await searchParams;
  const [catalogue, form] = await Promise.all([
    tiersOrNull(copy.audience),
    activeForm(copy.audience),
  ]);

  // `null` is "we cannot read the catalogue", which the empty branch below
  // already handles correctly — it says this audience is not open yet.
  const tiers = catalogue ?? [];

  const byId = new Map(tiers.map((t) => [t.id, t]));
  const preselected = (byId.has(params.tier ?? '') ? params.tier! : tiers[0]?.id) as TicketId;

  return (
    <>
      <section className="band band-navy">
        <div className="wrap">
          <p className="kicker">{ev.shortName} {ev.year}</p>
          <h1>{copy.heading}</h1>
          <p className="when">
            {ev.datesLong} | {ev.venueShort}
          </p>
          <p className="lede" style={{ maxWidth: '46rem' }}>
            {copy.lede}
          </p>
          {tiers.length > 0 && (
            <div className="cta">
              <Link href="#buy" className="btn btn-accent">
                Register
              </Link>
              <Link href="/tickets" className="btn btn-ghost">
                Attendee tickets
              </Link>
            </div>
          )}
        </div>
      </section>

      {/*
        The packages, in the same grid `/tickets` uses. Three booth sizes want
        their prices on one line where they can be read against each other, and
        their contents behind a disclosure — an exhibitor comparing packages is
        deciding on the number first.
      */}
      {tiers.length > 0 && (
        <section className="band band-centred">
          <div className="wrap">
            <h2>Packages</h2>

            {params.cancelled && (
              <p className="notice warn" style={{ marginTop: 20 }}>
                Checkout was cancelled and nothing was charged.
              </p>
            )}

            {/*
              The same card the attendee tickets page uses. Sponsorship
              packages are ticket tiers with bigger numbers on them, and two
              layouts for one object is two things to keep in step — which is
              how this page ended up with prices that lined up and a `/tickets`
              page whose prices did not.
            */}
            <div className="tier-grid">
              {tiers.map((t) => (
                <TierCard key={t.id} tier={t} href={`?tier=${t.id}#buy`} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="band band-wash" id="buy">
        <div
          className="wrap"
          style={{
            display: 'grid',
            gap: 40,
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            alignItems: 'start',
          }}
        >
          <div>
            <h2>{copy.heading}</h2>
            <ol className="steps" style={{ marginTop: 22 }}>
              {copy.points.map((p) => (
                <li key={p.title}>
                  <strong>{p.title}</strong>
                  {p.body}
                </li>
              ))}
            </ol>
            <p style={{ marginTop: 28 }}>
              <strong>Paying by invoice?</strong>{' '}
              <Link href="/tickets/invoice">Request one here</Link>. Net-14 to net-60, with a PO
              number.
            </p>
            <p>
              <strong>Questions?</strong>{' '}
              <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
            </p>
          </div>

          {tiers.length > 0 ? (
            <CheckoutForm
              tiers={tiers}
              initialTier={preselected}
              stripeReady={stripeEnabled()}
              demoReady={await demoCheckoutAllowed()}
              questions={form.fields}
            />
          ) : (
            /*
              An empty slice is a normal state, not an error: the organizer has
              not priced this audience yet. `listTiers` throws only when the
              whole collection is empty, which is a genuine misconfiguration.
            */
            <div className="checkout">
              <h2 style={{ fontSize: '1.4rem' }}>Not open yet</h2>
              <p className="notice warn">{copy.emptyHint}</p>
              <p>
                Write to <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and we will
                tell you as soon as it is.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
