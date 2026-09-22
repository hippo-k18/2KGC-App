import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import { tiersOrNull } from '@/lib/catalogue';
import { formatPrice, type Tier } from '@/lib/tickets';
import s from './tickets1.module.css';

/*
 * `noindex`, unlike `/tickets`.
 *
 * This route sells the same four tickets as `/tickets` from the same
 * catalogue, so left indexable it is a second page competing with the real one
 * for the same search — and the one a buyer would land on is decided by a
 * search engine rather than by us. Nothing links to it; it is kept as the
 * alternative layout, and it stays reachable to anyone holding the address.
 */
export const metadata: Metadata = {
  title: 'Tickets',
  description:
    'All Access, Main Conference, Workshops and Virtual tickets for the Knowledge Graph Conference 2027.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * `/tickets1` — the live site's own tickets layout, on the 2027 catalogue.
 *
 * ── What this is, and why it exists beside `/tickets` ──────────────────────
 *
 * `/tickets` is the Apple-clean redesign: no hero, a 2:1 lead panel and rows.
 * This route is the other answer to the same page — the layout the live KGC
 * site actually ships, rebuilt from `screenshot-to-code/kgc-inputs/site/
 * tickets.html` and the 1440px reference capture beside it. Two headline
 * panels of equal width, touching, one navy and one pale, each a centred
 * column of name, price, underlined section headings and bulleted contents;
 * then the footnote that says what Main Conference leaves out; then the navy
 * band carrying the two smaller tickets.
 *
 * Both routes read the same Firestore catalogue through `tiersOrNull`, so
 * nothing here can price a ticket differently from the page next door. The
 * layout is the only thing that differs.
 *
 * ── The one thing the live page does not have ─────────────────────────────
 *
 * Its hero: a photograph, "Tickets for / The Knowledge Graph Conference", the
 * dates, and an orange button. It is not reproduced. The page opens on "Main
 * Ticket Types" with the panels immediately under it, because the hero is a
 * full viewport of announcement in front of a price list somebody navigated
 * here specifically to read.
 */

/**
 * "KGC Video Library Subscription (3 months)" → the name, then the
 * parenthetical set small and unemphasised beside it.
 *
 * The live site marks up that trailing bracket as its own span precisely
 * because underlining "(3 months)" makes the duration look like part of the
 * product name. Split on the last opening bracket rather than a regex over the
 * whole string: a heading with no bracket is returned untouched, which is every
 * other heading in the catalogue.
 */
function splitParenthetical(heading: string): [string, string | null] {
  const at = heading.lastIndexOf('(');
  if (at < 1 || !heading.trimEnd().endsWith(')')) return [heading, null];
  return [heading.slice(0, at).trimEnd(), heading.slice(at)];
}

/**
 * One of the two headline panels.
 *
 * `tone` is the whole visual difference: navy ground with an orange button, or
 * pale ground with a navy one. It is a prop rather than a lookup on the tier
 * because which panel is dark is a fact about the *layout* — the left one is —
 * and not a fact about the ticket.
 */
function HeadlinePanel({ tier, tone }: { tier: Tier; tone: 'dark' | 'light' }) {
  const dark = tone === 'dark';

  /*
   * A tier with no `groups` still renders: its flat `includes` becomes a single
   * unheaded block of bullets. Only the two in-person headline tiers carry
   * groups today, and a third tier promoted to `featured` in the dashboard must
   * not render as an empty panel.
   */
  const groups = tier.groups?.length ? tier.groups : [{ heading: '', items: [...tier.includes] }];

  return (
    <article className={`${s.panel} ${dark ? s.panelDark : s.panelLight}`}>
      <h2 className={s.panelName}>{tier.name}</h2>
      <p className={s.panelPrice}>{formatPrice(tier.priceCents, tier.currency)}</p>
      {tier.tagline && <p className={s.panelTagline}>{tier.tagline}</p>}

      {groups.map((group, i) => {
        const [head, aside] = splitParenthetical(group.heading);
        return (
          <div className={s.group} key={group.heading || i}>
            {group.heading && (
              <h3 className={s.groupHead}>
                <span className={s.groupHeadText}>{head}</span>
                {aside && <span className={s.groupHeadAside}> {aside}</span>}
              </h3>
            )}
            {group.items?.length ? (
              <ul className={s.groupItems}>
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}

      <div className={s.action}>
        {tier.onSale ? (
          <Link
            className={`${s.cta} ${dark ? s.ctaOrange : s.ctaNavy}`}
            href={`/tickets/checkout?tier=${encodeURIComponent(tier.id)}`}
            aria-label={`Choose ${tier.name}`}
          >
            Choose
          </Link>
        ) : (
          <p className={s.closed}>{tier.unavailableReason ?? 'Sold out'}</p>
        )}
      </div>
    </article>
  );
}

/** One of the smaller tickets, in the navy band underneath. */
function SmallCard({ tier }: { tier: Tier }) {
  return (
    <article className={s.small}>
      <h3 className={s.smallName}>{tier.name}</h3>
      <p className={s.smallPrice}>{formatPrice(tier.priceCents, tier.currency)}</p>
      {tier.tagline && <p className={s.smallTagline}>{tier.tagline}</p>}

      <ul className={s.smallItems}>
        {tier.includes.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <div className={s.smallAction}>
        {tier.onSale ? (
          <Link
            className={`${s.cta} ${s.ctaOrange}`}
            href={`/tickets/checkout?tier=${encodeURIComponent(tier.id)}`}
            aria-label={`Choose ${tier.name}`}
          >
            Choose
          </Link>
        ) : (
          <p className={s.closed}>{tier.unavailableReason ?? 'Sold out'}</p>
        )}
      </div>
    </article>
  );
}

export default async function Tickets1Page({
  searchParams,
}: {
  searchParams: Promise<{ cancelled?: string }>;
}) {
  const params = await searchParams;

  /**
   * `null` means the catalogue could not be read at all — no credentials, or
   * the database is unreachable. That is not the same as having no tickets, and
   * it must never be rendered as a price.
   */
  const tiers = (await tiersOrNull()) ?? [];

  /*
   * The two panels are the `featured` tiers in catalogue order, which is what
   * the flag is for and what the dashboard's Create Tickets screen sets. If
   * fewer than two carry it the first two tiers stand in, so the band is never
   * a single lonely panel on half the measure.
   */
  const flagged = tiers.filter((t) => t.featured);
  const headline = (flagged.length >= 2 ? flagged : tiers).slice(0, 2);
  const headlineIds = new Set(headline.map((t) => t.id));
  const rest = tiers.filter((t) => !headlineIds.has(t.id));

  const [lead, second] = headline;

  /*
   * The footnote is replica copy about two specific tickets — that All Access
   * includes the limited-availability workshops and Main Conference does not.
   * It is rendered only when those two ids are in fact the ones on the panels;
   * re-pointing `featured` at a different pair in the dashboard drops the
   * footnote rather than printing a claim about tickets that are not there.
   */
  const footnoteApplies = headlineIds.has('all-access') && headlineIds.has('main-conference');

  /* "Two smaller tickets" is a count, so it has to follow the catalogue. */
  const smallerHeading =
    rest.length === 2 ? 'Two smaller tickets, Big impact.' : 'Smaller tickets, big impact.';

  return (
    <>
      <section className={s.mainTypes}>
        <div className={s.wrap}>
          <h1 className={s.h1}>Main Ticket Types</h1>

          {params.cancelled && (
            <p className={s.cancelled}>
              Checkout was cancelled and nothing was charged. Choose a ticket to try again.
            </p>
          )}

          {lead ? (
            <>
              <div className={s.pair}>
                <HeadlinePanel tier={lead} tone="dark" />
                {second && <HeadlinePanel tier={second} tone="light" />}
              </div>

              {footnoteApplies && (
                <div className={s.footnote}>
                  <p>
                    <strong>* {lead.name} Ticket</strong>: grants entry to <em>all</em> in-person
                    sessions, including limited-availability <strong>workshops</strong>, plus
                    virtual streaming and recordings.
                  </p>
                  <p>
                    <strong>* {second?.name} Ticket</strong>: covers all main conference sessions,
                    but <strong>does not include workshops</strong> (space is limited).
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className={s.empty}>
              Ticket sales for {SITE.name} have not opened yet. Write to{' '}
              <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and we will tell you
              the moment they do.
            </p>
          )}
        </div>
      </section>

      {rest.length > 0 && (
        <section className={s.smallerBand}>
          <div className={s.wrap}>
            <div className={s.smallerHead}>
              <h2>{smallerHeading}</h2>
              <p>Ideal if you’d like to start with a lighter commitment.</p>
            </div>

            <div className={s.smallRow}>
              {rest.map((tier) => (
                <SmallCard key={tier.id} tier={tier} />
              ))}
            </div>

            <p className={s.onDemand}>
              *All sessions will be available on demand for at least one month following the
              conference
            </p>
          </div>
        </section>
      )}

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
