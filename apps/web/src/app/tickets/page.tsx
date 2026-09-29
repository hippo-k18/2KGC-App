import type { Metadata } from 'next';
import Link from 'next/link';
import { siteEvent, ticketSalesOpen } from '@/lib/data';
import { SITE } from '@/lib/site';
import { tiersOrNull } from '@/lib/catalogue';
import { formatPrice, type Tier } from '@/lib/tickets';
import { monthName } from '@kgc/shared';
import s from './tickets.module.css';
import { TicketSalesClosed } from './sales-closed';

export const metadata: Metadata = {
  title: 'Tickets',
  description:
    'All Access, Main Conference, Workshops and Virtual tickets for the Knowledge Graph Conference 2027.',
};

/** Per-request, and it has to be. Prices and how many of each tier are left. `catalogue.ts` refuses to degrade quietly for exactly this reason: a stale price is indistinguishable from a correct one at the moment a card is charged, and a tier that sold out a minute ago must not still be on sale. */
export const dynamic = 'force-dynamic';

/**
 * The tickets page — choosing, and only choosing.
 *
 * ── Buying moved to its own page ───────────────────────────────────────────
 *
 * This page used to end in a `#buy` band carrying the whole checkout form:
 * every seat's name and email, the questionnaire, the tier selector and the pay
 * button. So a visitor who came to find out what a ticket costs was scrolled
 * past a form asking for somebody's dietary requirements, and "Choose" was a
 * link to an anchor a few hundred pixels down the page they were already on —
 * which reads as nothing happening.
 *
 * `Choose` now navigates to `/tickets/checkout?tier=…`, which is a page with
 * one job. Two things follow that are worth stating rather than discovering:
 * the tier travels in the URL, so a chosen ticket survives a reload and can be
 * linked to directly; and Stripe's `cancel_url` had to move with it
 * (`actions.ts`), because coming back from a cancelled payment to a page with
 * no form on it is a dead end.
 *
 * ── The shape ─────────────────────────────────────────────────────────────
 *
 * Three cards with one structure, the dearest one featured, each with its
 * details folded behind "What's included". `tickets.module.css` says why.
 */

/**
 * One ticket card. The same structure for all three tickets.
 *
 * At rest it shows only what a buyer compares: the name, the price (with the
 * phase it belongs to and the Super Early Bird price it replaced), a one-line
 * summary and Choose. Everything the ticket includes sits behind "What's
 * included", which the owner asked for on 2026-09-07 (expandable cards, less
 * text) and again on 2026-09-27 when the page had filled back up.
 *
 * `featured` changes colour only: the navy card and the orange button.
 * `<details>` gives the disclosure its expanded state and keyboard handling for
 * free, with no client JavaScript.
 *
 * Two parts: `cardMain` (the head, the price block and the summary) and the
 * details. On a laptop the first row's cards share row tracks for the head,
 * price and summary through `subgrid`, so those lines match across both cards,
 * and put the details on a row of their own, so opening one card grows that
 * card alone (T034, T038). The layout variants place them.
 */
function TicketCard({
  tier,
  featured = false,
  layout,
}: {
  tier: Tier;
  featured?: boolean;
  /**
   * Where the card sits: `wide` is All Access and `narrow` Main Conference,
   * side by side at 50/50 on the first row (the names are older than the
   * split), and `row` is Virtual across the full width underneath. The markup
   * is the same for all three; only the CSS differs.
   */
  layout: 'wide' | 'narrow' | 'row';
}) {
  /*
   * The same content each card showed before its details were folded away:
   * the featured card its grouped list, with heading-only groups ("KGC Video
   * Library Subscription (3 months)") under "Also included"; the others their
   * flat `includes`, whose copy differs from their `groups`.
   */
  const grouped = featured && tier.groups?.length ? tier.groups : null;
  const columns = grouped
    ? grouped.filter((g) => g.items?.length)
    : [{ heading: '', items: [...tier.includes] }];
  const extras = grouped ? grouped.filter((g) => !g.items?.length).map((g) => g.heading) : [];
  const addOns = tier.addOns?.length
    ? `Add ${tier.addOns
        .map((a) => `${a.name} for ${formatPrice(a.priceCents, tier.currency)}`)
        .join(' or ')} at checkout.`
    : null;

  return (
    <article
      className={`${s.card} ${s[layout]}${featured ? ` ${s.featured}` : ''}`}
      aria-labelledby={`name-${tier.id}`}
    >
      <div className={s.cardMain}>
        <div className={s.cardTop}>
          <div className={s.cardTitle}>
            <h2 id={`name-${tier.id}`} className={s.cardName}>
              {tier.name}
            </h2>
            {tier.badge ? <p className={s.badge}>{tier.badge}</p> : null}
          </div>

          {tier.onSale ? (
            <Link
              className={s.cta}
              href={`/tickets/checkout?tier=${encodeURIComponent(tier.id)}`}
              aria-label={`Choose ${tier.name}`}
            >
              Choose
            </Link>
          ) : (
            <p className={s.closed}>{tier.unavailableReason ?? 'Not available'}</p>
          )}
        </div>

        <div className={s.priceBlock}>
        <div className={s.priceRow}>
          <p className={s.price}>{formatPrice(tier.priceCents, tier.currency)}</p>
          {tier.phase ? <p className={s.phase}>{tier.phase}</p> : null}
        </div>
        {tier.earlierPhases?.map((e) => (
          <p className={s.earlier} key={e.name}>
            <s aria-label={`${e.name} price ${formatPrice(e.priceCents, tier.currency)}, no longer available`}>
              {formatPrice(e.priceCents, tier.currency)}
            </s>{' '}
            {e.name}
            {e.soldOut ? ', sold out' : ''}
          </p>
        ))}
        </div>

        <p className={s.summary}>{tier.tagline}</p>
      </div>

        <details className={s.more}>
          <summary className={s.moreToggle}>
            What’s included<span className="sr-only"> in {tier.name}</span>
          </summary>
          <div className={s.moreBody}>
            {columns.map((g, i) => (
              <div key={g.heading || i}>
                {g.heading ? <h3 className={s.groupHead}>{g.heading}</h3> : null}
                <ul className={s.items}>
                  {(g.items ?? []).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
            {extras.length > 0 ? (
              <div>
                <h3 className={s.groupHead}>Also included</h3>
                <ul className={s.items}>
                  {extras.map((heading) => (
                    <li key={heading}>{heading}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {addOns ? <p className={s.addOn}>{addOns}</p> : null}
          </div>
        </details>
    </article>
  );
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string }>;
}) {
  if (!(await ticketSalesOpen())) return <TicketSalesClosed />;
  const ev = await siteEvent();
  const params = await searchParams;

  /**
   * `null` means the catalogue could not be read at all — no credentials, or
   * the database is unreachable. That is not the same as having no tickets, and
   * it must never be rendered as a price.
   */
  const tiers = (await tiersOrNull()) ?? [];

  /*
   * Dearest first, by price rather than by id or the `featured` flag, so the
   * order survives an edit to the catalogue. The dearest card is the featured
   * one.
   */
  const ranked = [...tiers].sort((a, b) => b.priceCents - a.priceCents);

  /*
   * The soonest day any ticket on sale gets dearer. Only the month is said,
   * never the new price.
   */
  const risesOn = tiers
    .filter((t) => t.onSale && t.risesOn)
    .map((t) => t.risesOn!)
    .sort()[0];

  return (
    <>
      <div className={s.page}>
        <header className={s.head}>
          <h1 className={s.h1}>Tickets</h1>
          <p className={s.orient}>
            {ev.datesLong} at {ev.venueShort}.
          </p>
          {risesOn ? (
            <p className={s.rise}>Prices will increase in {monthName(risesOn)}</p>
          ) : null}

          {params.cancelled && (
            <p className={s.cancelled}>
              Checkout was cancelled and nothing was charged. Choose a ticket to try again.
            </p>
          )}
        </header>

        {ranked.length > 0 ? (
          <div className={s.cards}>
            {ranked.map((t, i) => (
              <TicketCard
                key={t.id}
                tier={t}
                featured={i === 0}
                layout={i === 0 ? 'wide' : i === 1 ? 'narrow' : 'row'}
              />
            ))}
          </div>
        ) : (
          <p className={s.empty}>
            Ticket sales for {ev.name} have not opened yet. Write to{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and we will tell you
            the moment they do.
          </p>
        )}
      </div>

      {/*
        The questions, collapsed. Kept where the "From paying to standing in the
        room" strip was cut: five rows a click away cost almost no height, and
        each one is a real question somebody writes in about — transfers, the
        student rate, invoicing.
      */}
      <section className="band-wash">
        <div className="kgc-faq">
          <h2>Questions</h2>

          <details>
            <summary>Can I transfer my ticket to someone else?</summary>
            <div className="answer">
              <p>
                Yes, up to a week before the conference. Mail{' '}
                <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> with the new
                attendee’s details and we will move the registration.
              </p>
            </div>
          </details>

          <details>
            <summary>Is there a student rate?</summary>
            <div className="answer">
              <p>Yes. Write to us from your institutional address before you buy.</p>
            </div>
          </details>

          <details>
            <summary>Do virtual tickets include the recordings?</summary>
            <div className="answer">
              <p>Yes. Every session, on demand, for at least a month after the conference.</p>
            </div>
          </details>

          <details>
            <summary>What if I use a different email address at work?</summary>
            <div className="answer">
              <p>
                Buy with the one you want your ticket on. If you need both, write to us and we will
                attach the second address to your registration.
              </p>
            </div>
          </details>

          <details>
            <summary>Can we pay by invoice?</summary>
            <div className="answer">
              <p>
                Yes. <Link href="/tickets/invoice">Request one here</Link>. Net-14 to net-60 terms,
                with a PO number on the invoice.
              </p>
            </div>
          </details>
        </div>
      </section>

      {/* The live site closes every page of this kind with "Find us". */}
      <section className="band">
        <div className="wrap">
          <div className="find-us">
            <h2>Find us</h2>
            <div className="cols">
              <div>
                <p className="k">Email</p>
                <p className="v">
                  <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
                </p>
              </div>
              <div>
                <p className="k">Address</p>
                <p className="v">Jay Conference Bryant Park &amp; globally online</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
