import type { Metadata } from 'next';
import { listSponsorsByTier } from '@/lib/data';
import { tiersOrNull } from '@/lib/catalogue';
import { SponsorTiers } from '@/components/sponsor-tiers';
import { TierCard } from '../tickets/tier-card';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Sponsor KGC',
  description:
    'Sponsorship and speaking opportunities at the Knowledge Graph Conference 2027, Bryant Park, New York.',
};

/**
 * Rendered once and reused for up to a minute, rather than from scratch on
 * every visit. Tiers and logos change when an organizer edits them, not per visitor.
 *
 * Every page on this site was `force-dynamic`, so nothing was ever cached by
 * anybody: the agenda took 0.81 to 0.95 seconds to first byte on the live site
 * against 0.06 for a page that read nothing. No visitor now pays for a query
 * another visitor has already made.
 *
 * Thirty seconds and not sixty, because this window sits on top of the one in
 * `shared()` and the two add up. See `SHARED_SECONDS` in `lib/data.ts`: thirty
 * over thirty is a change on the site inside a minute, which is what an
 * organizer who saves and switches tab is waiting for.
 */
export const revalidate = 30;

/*
 * The packages come from `ticketTypes`, not from a constant here.
 *
 * ── Two public pages were describing one product ────────────────────────────
 *
 * This file held a `PACKAGES` array — Platinum/Gold/Silver/Bronze with a
 * hand-written benefit list each — while `/tickets/sponsor` rendered the
 * `includes` array off the `audience: 'sponsor'` documents that actually sell
 * those packages. Same site, same four tiers, two descriptions, and only one of
 * them was the record a buyer's order is written against. They had already
 * diverged: this page said Gold gets "six full-conference passes" and the tier
 * being sold says eight All Access ones.
 *
 * A constant loses that argument on every axis. It is edited by a deploy rather
 * than by the organizer who priced the tier, and it is the copy nobody thinks
 * to change when the package changes. So the marketing page and the checkout
 * page now read the same documents, and the only thing this one adds is the
 * link that takes you to the other.
 *
 * ── And they were drawing them two different ways ───────────────────────────
 *
 * Reading the same documents was only half of it. This page then printed every
 * `includes` line of all four tiers in a three-column grid, which put Bronze,
 * Silver and Gold in row one and left Platinum alone at a third of the width in
 * row two — and printed, at full length, the contents `/tickets/sponsor` shows
 * behind a disclosure. `TierCard` is that page's card, so four tiers now sit
 * four across with the same prices, the same one-line scope and the same
 * expandable contents, and the difference between the two pages is which of
 * them takes the money.
 *
 * ── Prices are quoted now, because the sibling page already quotes them ─────
 *
 * The old comment here said no prices were shown because the real prospectus is
 * a Coda doc the live nav links out to and is the authority on what a tier
 * costs. That reasoning stopped holding when `/tickets/sponsor` went live
 * publishing exactly these figures: withholding them here made this page look
 * coy, not discreet, about a number one click away.
 *
 * Catalogue order — `sortOrder`, ascending, which is Bronze first — is the same
 * order `/tickets/sponsor` uses. Reversing it here to lead with Platinum would
 * be a second opinion about the same list.
 */

/*
 * ── No tint bands, and three spacing steps instead ──────────────────────────
 *
 * The four sections used to alternate white, tint, white, tint at an identical
 * 64px of padding each, so the page read as four interchangeable stripes with
 * nothing weighted above anything else. The pitch, the prices and the wall of
 * logos are one continuous argument and are now spaced as one; the call for
 * speakers is a different ask of a different reader, and the only large gap on
 * the page is the one in front of it. `.tint` itself is untouched — the replica
 * pages still use it.
 */

export default async function SponsorPage() {
  /*
   * `tiersOrNull`, not `listTiers`: this is a marketing page, and an
   * unreachable catalogue should cost it the Packages band, not the sponsor
   * wall and the call for speakers underneath. The tickets pages keep the loud
   * failure, because a price that fails quietly is the one that gets charged.
   */
  const [bands, packages] = await Promise.all([
    listSponsorsByTier(),
    tiersOrNull('sponsor'),
  ]);

  return (
    <>
      <section style={{ paddingBottom: 40 }}>
        <div className="wrap">
          <h1>Sponsor KGC 2027</h1>
          <p className="lede">
            A thousand people who buy, build and operate knowledge graph infrastructure, in one
            building for five days.
          </p>
          <p>
            Sponsorship enquiries:{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
          </p>
        </div>
      </section>

      {packages && packages.length > 0 && (
        <section style={{ paddingBlock: '0 56px' }}>
          <div className="wrap">
            <h2>Packages</h2>
            {/*
              `maxWidth: 'none'` because `.tier-grid` centres itself in a
              1120px measure, which is right on `/tickets/sponsor` where the
              whole band is centred and wrong here, where it would inset the
              row 56px from the heading above it.

              Each card links straight to its own tier on the checkout page,
              so the standalone "Become a sponsor" button underneath went: four
              calls to action and a fifth one repeating them is the shape of a
              page that does not know which one it means.
            */}
            <div className="tier-grid" style={{ marginTop: 24, maxWidth: 'none' }}>
              {packages.map((p) => (
                <TierCard key={p.id} tier={p} href={`/tickets/sponsor?tier=${p.id}#buy`} />
              ))}
            </div>
          </div>
        </section>
      )}

      {bands.length > 0 && (
        <section style={{ paddingBlock: '0 24px' }}>
          <div className="wrap">
            <h2>Our sponsors</h2>
            {/*
              `titles="label"`, because the packages above are already headed
              Bronze, Silver, Gold, Platinum, and the wall repeating the same
              four words at the same weight in the opposite order read as one
              list poured into two slots. The homepage keeps the widget's own
              centred titles: nothing up the page from it has said them.
            */}
            <SponsorTiers bands={bands} titles="label" />
          </div>
        </section>
      )}

      <section style={{ paddingBlock: '80px' }} id="speak">
        <div className="wrap">
          <h2>Speak at KGC</h2>
          {/*
            `.wrap`, not `.wrap.narrow`. Narrow centres a 760px column inside a
            full-width band, so this one started 250px to the right of every
            heading above it while its background ran the whole screen. The
            paragraphs keep the measure `.narrow` gave them and lose the indent.
          */}
          <p style={{ maxWidth: '68ch' }}>
            We look for specific work: a system you built, a modelling decision you would change, a
            migration that went sideways, an evaluation with numbers in it. Product tours belong at
            the booth.
          </p>
          <p style={{ maxWidth: '68ch' }}>
            Formats are a 25-minute talk, a 45-minute deep dive, a panel or a half-day workshop.
            Submissions open in September and close in December.
          </p>
          <p>
            <a className="btn btn-primary" href={`mailto:${SITE.contactEmail}?subject=KGC%202027%20talk%20proposal`}>
              Pitch a talk
            </a>
          </p>
        </div>
      </section>
    </>
  );
}
