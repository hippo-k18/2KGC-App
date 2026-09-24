import type { Metadata } from 'next';
import Link from 'next/link';
import { siteEvent } from '@/lib/data';
import { SITE } from '@/lib/site';
import { tiersOrNull } from '@/lib/catalogue';
import { formatPrice, type Tier } from '@/lib/tickets';
import s from './tickets.module.css';

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
 * Two panels on one line at 2/3 and 1/3 — the flagship and Main Conference —
 * then the rest as rows. Adapted from `options/v8`; `tickets.module.css` header
 * carries the reasoning and the reductions.
 *
 * ⚠️ **The two rows below are meant to be partly cut off at the fold.** That is
 * the point of the sizing, not a layout that ran out of room: a page ending
 * cleanly under the top line reads as a page with two tickets on it, and
 * Workshops and Virtual are then never found. If you add vertical space here,
 * check what the fold does at 900px before you keep it.
 */

/**
 * The flagship: name, price and button on one line, contents in columns below.
 *
 * The button says "Choose", not "Choose All Access (VIP)". With the tier name
 * in it the button came to 301px, the three items on the strip totalled 683px
 * inside 670px, and the whole block wrapped to three lines — 115px instead of
 * 59px, which is most of the height the rows below need to reach the fold. The
 * name it would have repeated is six inches to its left. `aria-label` carries
 * the full phrase, so nothing is lost to a screen reader reading the button out
 * of context.
 */
function LeadPanel({ tier }: { tier: Tier }) {
  /*
   * The grouped shape is the panel's structure. A group with items becomes a
   * column; a group that is only a heading — "KGC Video Library Subscription
   * (3 months)" — becomes the line under them, because an empty column with a
   * rule over it reads as something that failed to load.
   */
  const groups = tier.groups?.length ? tier.groups : [{ heading: '', items: [...tier.includes] }];
  const columns = groups.filter((g) => g.items && g.items.length > 0);
  const extras = groups.filter((g) => !g.items || g.items.length === 0).map((g) => g.heading);

  return (
    <article className={s.lead} aria-labelledby="lead-name">
      <div className={s.leadHead}>
        <h2 id="lead-name" className={s.leadName}>
          {tier.name}
        </h2>
        <p className={s.leadPrice}>{formatPrice(tier.priceCents, tier.currency)}</p>

        {tier.onSale ? (
          <Link
            className={s.leadCta}
            href={`/tickets/checkout?tier=${encodeURIComponent(tier.id)}`}
            aria-label={`Choose ${tier.name}`}
          >
            Choose
          </Link>
        ) : (
          <p className={s.leadClosed}>{tier.unavailableReason ?? 'Not available'}</p>
        )}
      </div>

      <div className={s.leadBody}>
        {columns.map((g, i) => (
          <div className={s.group} key={g.heading || i}>
            {g.heading ? <h3 className={s.groupHead}>{g.heading}</h3> : null}
            <ul className={s.groupItems}>
              {(g.items ?? []).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
        {extras.length > 0 && (
          <p className={s.extras}>
            <span className={s.extrasLabel}>Also included</span>
            {extras.map((heading) => (
              <span className={s.extrasItem} key={heading}>
                {heading}
              </span>
            ))}
          </p>
        )}
      </div>
    </article>
  );
}

/**
 * Main Conference, in the third beside the flagship.
 *
 * `includes` flat rather than `groups`: there is one column of room here, and
 * group headings in a single narrow column are rules with one item under each.
 */
function SecondPanel({ tier }: { tier: Tier }) {
  return (
    <article className={s.second} aria-labelledby="second-name">
      <h2 id="second-name" className={s.secondName}>
        {tier.name}
      </h2>
      <p className={s.secondPrice}>{formatPrice(tier.priceCents, tier.currency)}</p>

      <ul className={s.secondItems}>
        {tier.includes.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {tier.onSale ? (
        <p className={s.secondCta}>
          <Link
            href={`/tickets/checkout?tier=${encodeURIComponent(tier.id)}`}
            aria-label={`Choose ${tier.name}`}
          >
            Choose
          </Link>
        </p>
      ) : (
        <p className={s.secondClosed}>{tier.unavailableReason ?? 'Not available'}</p>
      )}
    </article>
  );
}

/** One row: identity and price, everything it includes, and the way in. */
function AlternativeRow({ tier }: { tier: Tier }) {
  return (
    <li className={s.alt}>
      <div className={s.altIdent}>
        <h3 className={s.altName}>{tier.name}</h3>
        <p className={s.altPrice}>{formatPrice(tier.priceCents, tier.currency)}</p>
      </div>

      <ul className={s.altItems}>
        {tier.includes.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <div className={s.altAction}>
        {tier.onSale ? (
          <Link
            className={s.altCta}
            href={`/tickets/checkout?tier=${encodeURIComponent(tier.id)}`}
            aria-label={`Choose ${tier.name}`}
          >
            Choose
          </Link>
        ) : (
          <p className={s.altClosed}>{tier.unavailableReason ?? 'Not available'}</p>
        )}
      </div>
    </li>
  );
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const ev = await siteEvent();
  const params = await searchParams;

  /**
   * `null` means the catalogue could not be read at all — no credentials, or
   * the database is unreachable. That is not the same as having no tickets, and
   * it must never be rendered as a price.
   */
  const tiers = (await tiersOrNull()) ?? [];

  /*
   * The two panels are the two dearest tiers, by price, rather than by id or by
   * the `featured` flag. Four tiers carry `featured`, and an id written into a
   * layout is an id that is wrong the first time somebody edits the catalogue.
   */
  const ranked = [...tiers].sort((a, b) => b.priceCents - a.priceCents);
  const [lead, second, ...rest] = ranked;

  return (
    <>
      <div className={s.page}>
        <header className={s.head}>
          <h1 className={s.h1}>Tickets</h1>
          <p className={s.orient}>
            {ev.datesLong} at {ev.venueShort}.
          </p>

          {params.cancelled && (
            <p className={s.cancelled}>
              Checkout was cancelled and nothing was charged. Choose a ticket to try again.
            </p>
          )}
        </header>

        {lead ? (
          <>
            <div className={s.top}>
              <LeadPanel tier={lead} />
              {second && <SecondPanel tier={second} />}
            </div>

            {rest.length > 0 && (
              <ul className={s.altRows}>
                {rest.map((t) => (
                  <AlternativeRow key={t.id} tier={t} />
                ))}
              </ul>
            )}
          </>
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
                Sign in with either and use the claim code from your confirmation page. We can
                attach alternate addresses to one registration.
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
                <p className="v">Cornell Tech &amp; globally online</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
