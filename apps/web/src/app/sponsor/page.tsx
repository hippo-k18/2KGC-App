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
              <div className="package-head">
                <h2>Sponsor Packages</h2>
                <a
                  className="btn btn-secondary btn-sm"
                  href={PROSPECTUS_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Info: the full sponsorship prospectus, in a new tab"
                >
                  Info
                </a>
              </div>
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

/** The full prospectus, kept by the organizers outside this site. */
const PROSPECTUS_URL =
  'https://docs.superhuman.com/d/Knowledge-Graph-Conference-Sponsorship-Prospectus_dbvrFq8v5WB/Knowledge-Graph-Conference-2027_suMDKRAQ#_lu_XTxuJ';

/*
 * Plain wording for this page, keyed by tier id. Same facts as the catalogue,
 * shorter sentences. A tier added later with no entry here falls back to its
 * catalogue tagline and list, so a new package still shows up.
 */
const PLAIN: Record<string, { summary: string; items: string[] }> = {
  'sponsor-bronze': {
    summary: 'Your logo on the website and a listing in the app.',
    items: [
      'Listing in the KGC app all week',
      'Logo on the sponsor wall and the website',
      '2 Main Conference passes',
      'Attendee demographics after the event',
    ],
  },
  'sponsor-silver': {
    summary: 'Everything in Bronze, plus signs in the session rooms and a banner in the app.',
    items: [
      'Everything in Bronze',
      'Banner in the app',
      'Logo on session room signs',
      '4 All Access passes',
      'Contacts from attendees who opt in',
    ],
  },
  'sponsor-gold': {
    summary: 'A 30-minute session in the agenda and a booth.',
    items: [
      'Everything in Silver',
      '30-minute session in the agenda',
      'Logo on the main stage backdrop',
      '8 All Access passes',
      'Standard booth in the exhibition hall',
    ],
  },
  'sponsor-platinum': {
    summary: 'One sponsor a year. Your name on the conference, a 45-minute session and a premium booth.',
    items: [
      'Everything in Gold',
      'Your name on all conference branding',
      '45-minute session next to the keynotes',
      'Logo on attendee lanyards',
      '16 All Access passes',
      'Premium booth in the exhibition hall',
    ],
  },
};

/**
 * One package as a flat block: its name and one line always, and the full
 * list on hover or keyboard focus.
 */
function PackageBlock({ tier }: { tier: Tier }) {
  const plain = PLAIN[tier.id];
  const summary = plain?.summary ?? tier.tagline;
  const items =
    plain?.items ??
    (tier.groups ?? [{ heading: '', items: [...tier.includes] }]).flatMap((g) => g.items ?? []);
  return (
    /*
      `tabIndex` so a keyboard can open it too. Phones have no hover, so there
      the list is always shown.
    */
    <article
      className={`flat-block package${tier.featured ? ' is-featured' : ''}`}
      tabIndex={0}
      aria-label={`${tier.name} package`}
    >
      <h3>{tier.name}</h3>
      <p className="package-line">{summary}</p>
      <div className="package-more">
        <div>
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
