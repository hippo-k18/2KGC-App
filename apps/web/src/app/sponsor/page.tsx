import type { Metadata } from 'next';
import { listSponsorsByTier } from '@/lib/data';
import { tiersOrNull } from '@/lib/catalogue';
import { SponsorTiers } from '@/components/sponsor-tiers';
import type { Tier } from '@/lib/tickets';
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
 * ── Drawn here as plain blocks, and sold by email ───────────────────────────
 *
 * This page shows what each package includes and sends people to the inbox.
 * No prices and no checkout button: sponsorship is agreed with a person.
 * `/tickets/sponsor` still exists and quotes the figures for anyone sent there.
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
 * nothing weighted above anything else. The call for speakers now sits in a
 * box under the title, and the packages and the wall of logos follow it,
 * spaced as one continuous list. `.tint` itself is untouched — the replica
 * pages still use it.
 */

export default async function SponsorPage() {
  /*
   * `tiersOrNull`, not `listTiers`: this is a marketing page, and an
   * unreachable catalogue should cost it the package blocks, not the sponsor
   * wall and the call for speakers. The tickets pages keep the loud
   * failure, because a price that fails quietly is the one that gets charged.
   */
  const [bands, packages] = await Promise.all([
    listSponsorsByTier(),
    tiersOrNull('sponsor'),
  ]);

  const mail = (subject: string) =>
    `mailto:${SITE.contactEmail}?subject=${encodeURIComponent(subject)}`;

  return (
    <>
      {/* No visible title: the page opens on the talk block. Screen readers
          still get a heading to land on. */}
      <h1 className="sr-only">Sponsor KGC 2027</h1>

      {/*
        One white band for the talk and the packages, with flat grey blocks on
        it: the same square panel as the homepage FAQ. `id="speak"` is where the
        footer's "Speak at KGC" link lands.
      */}
      <section className="band-white" style={{ paddingBlock: '48px 64px' }}>
        <div className="wrap">
          <div className="flat-block speak-box" id="speak">
            <h2>Speak at KGC</h2>
            <p>
              Tell us about real work: something you built, a decision you would change, a project
              that went wrong, results you measured. No product pitches.
            </p>
            <p>
              Talks run 25 or 45 minutes, and there are panels and half-day workshops. Submissions
              open in September and close in December.
            </p>
            <p className="speak-box-cta">
              <a className="btn btn-primary" href={mail('KGC 2027 talk proposal')}>
                Pitch a talk
              </a>
            </p>
          </div>

          {packages && packages.length > 0 && (
            <>
              <h2 style={{ marginTop: 56 }}>Packages</h2>
              <div className="package-grid">
                {packages.map((p) => (
                  <PackageBlock key={p.id} tier={p} />
                ))}
              </div>
            </>
          )}

          {/*
            Sponsorship is arranged by email, not bought on this page. The
            subject line tells whoever reads the inbox what it is about.
          */}
          <div className="package-contact">
            <p>
              To sponsor, email{' '}
              <a href={mail('KGC 2027 sponsorship')}>{SITE.contactEmail}</a>. Tell us which package
              you are interested in.
            </p>
            <a className="btn btn-primary" href={mail('KGC 2027 sponsorship')}>
              Email us
            </a>
          </div>
        </div>
      </section>

      {bands.length > 0 && (
        <section style={{ paddingBlock: '56px 80px' }}>
          <div className="wrap">
            <h2>Our sponsors</h2>
            {/*
              `titles="label"`, because the packages above are already headed
              Bronze, Silver, Gold, Platinum, and the wall repeating the same
              four words at the same weight in the opposite order read as one
              list poured into two slots. The homepage keeps the widget's own
              centred titles: nothing up the page from it has said them.
            */}
            <SponsorTiers bands={bands} titles="label" blend />
          </div>
        </section>
      )}

    </>
  );
}

/**
 * One package as a flat block: its name, and on hover the line of scope and
 * everything it includes.
 */
function PackageBlock({ tier }: { tier: Tier }) {
  const items = (tier.groups ?? [{ heading: '', items: [...tier.includes] }]).flatMap(
    (g) => g.items ?? [],
  );
  return (
    /*
      Only the name shows until the block is hovered or focused, then the
      tagline and list open underneath. `tabIndex` so a keyboard can open it
      too. Phones have no hover, so there the block is always open.
    */
    <article
      className={`flat-block package${tier.featured ? ' is-featured' : ''}`}
      tabIndex={0}
      aria-label={`${tier.name} package`}
    >
      <h3>{tier.name}</h3>
      <div className="package-more">
        <div>
          <p className="package-line">{tier.tagline}</p>
          <ul>
            {items.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}
