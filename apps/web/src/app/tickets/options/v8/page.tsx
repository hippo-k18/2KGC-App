import Link from 'next/link';
import { loadOptionData, OptionChrome, BuyBand, AfterBands } from '../shared';
import { SITE } from '@/lib/site';
import { formatPrice, type Tier } from '@/lib/tickets';
import s from './styles.module.css';

/** Per-request, and it has to be. Prices, for the reason `tickets/page.tsx` gives. These are layout options for the tickets page and read the same catalogue, so a stale price would be a stale price here too. */
export const dynamic = 'force-dynamic';

/**
 * Option 8 — lead panel and alternatives.
 *
 * ── Why one tier gets the room ──────────────────────────────────────────────
 *
 * Four equal columns spend equal design attention on a $349 ticket and a $1,199
 * ticket. That is not how the page should be weighted: the top tier is the one
 * with three groups of contents to explain and the one whose price needs an
 * argument, so it gets a full-width panel with its groups laid out side by side
 * instead of a card column that squeezes eleven bullets into 240px.
 *
 * The other tiers are not punished for it. They sit underneath as full-width
 * rows with every bullet on show — no disclosure, no "compare" link — under a
 * heading that says plainly what they are for. Somebody who only wants the
 * workshops scrolls past one panel, not a wall of persuasion, and finds their
 * ticket listed completely.
 *
 * ── The emphasis is the layout, not a badge ─────────────────────────────────
 *
 * No "Most popular", no ribbon, no timer. Scale does the work, and the only two
 * persuasive lines on the page are facts computed from the catalogue: that this
 * is the one ticket covering both halves of the week, and what the two halves
 * cost bought separately.
 */

const N = 8;

const buyHref = (id: string) => `/tickets/options/v${N}?tier=${encodeURIComponent(id)}#buy`;

/**
 * The panel.
 *
 * `pair` is the two in-person tiers this one subsumes, or `null` when the
 * catalogue is not shaped that way any more — an organizer who adds a fifth
 * in-person tier gets no arithmetic rather than wrong arithmetic.
 */
function LeadPanel({ tier, pair }: { tier: Tier; pair: [Tier, Tier] | null }) {
  /*
   * The grouped shape is the panel's structure. A group with items becomes a
   * column; a group that is only a heading — "KGC Video Library Subscription
   * (3 months)" — becomes the line under them, because an empty column with a
   * rule over it reads as something that failed to load.
   */
  const groups = tier.groups?.length ? tier.groups : [{ heading: '', items: [...tier.includes] }];
  const columns = groups.filter((g) => g.items && g.items.length > 0);
  const extras = groups.filter((g) => !g.items || g.items.length === 0).map((g) => g.heading);

  const separately = pair ? pair[0].priceCents + pair[1].priceCents : 0;
  const saving = separately - tier.priceCents;
  const showSum = pair !== null && saving > 0;

  return (
    <article className={s.lead} aria-labelledby="lead-name">
      <div className={s.leadHead}>
        <h2 id="lead-name" className={s.leadName}>
          {tier.name}
        </h2>
        <p className={s.leadTagline}>{tier.tagline}</p>
        <p className={s.leadPrice}>{formatPrice(tier.priceCents, tier.currency)}</p>

        {pair && (
          <p className={s.leadClaim}>
            The one ticket that covers both halves of the week: the workshop days,{' '}
            {SITE.workshopDays}, and the conference days, {SITE.conferenceDays}.
          </p>
        )}

        {showSum && pair && (
          <dl className={s.sum}>
            <div className={s.sumRow}>
              <dt>
                {pair[0].name} and {pair[1].name}, bought separately
              </dt>
              <dd>{formatPrice(separately, pair[0].currency)}</dd>
            </div>
            <div className={`${s.sumRow} ${s.sumTotal}`}>
              <dt>{tier.name}, together</dt>
              <dd>{formatPrice(tier.priceCents, tier.currency)}</dd>
            </div>
          </dl>
        )}
        {showSum && (
          <p className={s.sumNote}>
            {formatPrice(saving, tier.currency)} less than buying the week in two parts.
          </p>
        )}

        {tier.onSale ? (
          <Link className={s.leadCta} href={buyHref(tier.id)}>
            Choose {tier.name}
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

/** One alternative: identity, the whole of what it includes, and the way in. */
function AlternativeRow({ tier }: { tier: Tier }) {
  return (
    <li className={s.alt}>
      <div className={s.altIdent}>
        <h3 className={s.altName}>{tier.name}</h3>
        <p className={s.altPrice}>{formatPrice(tier.priceCents, tier.currency)}</p>
        <p className={s.altTagline}>{tier.tagline}</p>
      </div>

      <ul className={s.altItems}>
        {tier.includes.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <div className={s.altAction}>
        {tier.onSale ? (
          <Link className={s.altCta} href={buyHref(tier.id)} aria-label={`Choose ${tier.name}`}>
            Choose
          </Link>
        ) : (
          <p className={s.altClosed}>{tier.unavailableReason ?? 'Not available'}</p>
        )}
      </div>
    </li>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  const data = await loadOptionData(await searchParams);
  const tiers = data.tiers;

  /*
   * The panel goes to the dearest ticket rather than to `all-access` by id or
   * to the first `featured` flag — two tiers carry `featured`, and an id in a
   * layout decision is an id that will be wrong the first time the catalogue is
   * edited.
   */
  const lead = tiers.reduce<Tier | undefined>(
    (best, t) => (!best || t.priceCents > best.priceCents ? t : best),
    undefined,
  );
  const others = tiers.filter((t) => t.id !== lead?.id);
  const inPersonOthers = others.filter((t) => t.inPerson);
  const pair =
    lead?.inPerson && inPersonOthers.length === 2
      ? ([inPersonOthers[0], inPersonOthers[1]] as [Tier, Tier])
      : null;

  return (
    <OptionChrome
      n={N}
      name="Lead panel and alternatives"
      note="One tier gets a full-width panel; the rest get complete, compact rows underneath."
    >
      <div className={s.page}>
        <header className={s.head}>
          <h1 className={s.h1}>Tickets</h1>
          <p className={s.orient}>
            {SITE.datesLong}, {SITE.venueShort}. Workshops open the week on Monday and Tuesday;
            the conference runs Wednesday to Friday.
          </p>
          {data.cancelled && (
            <p className={s.cancelled}>
              Checkout was cancelled and nothing was charged. Your details are in the form below
              if you want to try again.
            </p>
          )}
        </header>

        {lead ? (
          <>
            <LeadPanel tier={lead} pair={pair} />

            {others.length > 0 && (
              <section className={s.alts} aria-labelledby="alts-heading">
                <div className={s.altsHead}>
                  <h2 id="alts-heading" className={s.altsTitle}>
                    If you only need part of the week
                  </h2>
                  <p className={s.altsNote}>
                    Each of these stands on its own, and everything it includes is listed here.
                  </p>
                </div>
                <ul className={s.altRows}>
                  {others.map((t) => (
                    <AlternativeRow key={t.id} tier={t} />
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : (
          <p className={s.empty}>
            Ticket sales for {SITE.name} have not opened yet. Everything else on this page is
            current.
          </p>
        )}
      </div>

      <BuyBand data={data} />
      <AfterBands />
    </OptionChrome>
  );
}
