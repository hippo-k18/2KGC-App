import type { Metadata } from 'next';
import { listSponsorsByTier } from '@/lib/data';
import { SponsorTiers } from '@/components/sponsor-tiers';
import { SITE } from '@/lib/site';
import Image from 'next/image';
import s from './sponsor.module.css';

export const metadata: Metadata = {
  title: 'Sponsor the Knowledge Graph Conference',
  description:
    'Sponsorship and speaking opportunities at the Knowledge Graph Conference 2027, Jay Conference Bryant Park, New York.',
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
 * No packages on this page (T187).
 *
 * The four tiers, their benefit lists and an "Ask about" link each used to sit
 * under the photos. The owner asked for them to go and for the way to get in
 * touch to be bigger, so the page now has one call to action: email us, or read
 * the prospectus. The tiers still exist in `ticketTypes`, and `/tickets/sponsor`
 * still quotes them for anyone sent there.
 */

/*
 * ── No tint bands, and three spacing steps instead ──────────────────────────
 *
 * The four sections used to alternate white, tint, white, tint at an identical
 * 64px of padding each, so the page read as four interchangeable stripes with
 * nothing weighted above anything else. The page now opens on the sponsor
 * quote and the photos, then the call to sponsor, the wall of logos and the
 * call for speakers, spaced as one continuous list. `.tint` itself is untouched — the replica
 * pages still use it.
 */

export default async function SponsorPage() {
  const bands = await listSponsorsByTier();

  const mail = (subject: string) =>
    `mailto:${SITE.contactEmail}?subject=${encodeURIComponent(subject)}`;

  return (
    <>
      {/*
        The page opens on a sponsor's own words and the room itself (T173).
        The owner asked for this in place of the call for speakers and the
        package heading that used to fill the first screen. The title stays a
        real h1, set small above the quote.
      */}
      <section className={s.hero} aria-labelledby="sponsor-title">
        <div className="wrap">
          <h1 id="sponsor-title" className={s.title}>
            Sponsor KGC 2027
          </h1>
          <figure className={s.quote}>
            <blockquote>
              <p>
                KGC is the only conference where I don&rsquo;t have to explain what semantics and
                knowledge graphs are.
              </p>
            </blockquote>
            <figcaption>Long time sponsor</figcaption>
          </figure>

          <ul className={s.photos} aria-label="Photos from past conferences">
            {PHOTOS.map((photo, i) => (
              <li key={photo.src}>
                <Image
                  src={photo.src}
                  alt={photo.alt}
                  fill
                  sizes="(width >= 768px) 33vw, 50vw"
                  priority={i === 0}
                  className={s.photo}
                  style={photo.position ? { objectPosition: photo.position } : undefined}
                />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/*
        The one call to action (T187): email, or the prospectus. Big enough to
        be the obvious next step after the photos, and full width on a phone.
        The subject line tells whoever reads the inbox what it is about.
      */}
      <section className="band-white" style={{ paddingBlock: '0 72px' }}>
        <div className="wrap">
          <div className={s.cta}>
            <div>
              <h2 className={s.ctaTitle}>Become a sponsor</h2>
              <p className={s.ctaLine}>
                Tell us what you&rsquo;d like to achieve and we&rsquo;ll send the options.
              </p>
            </div>
            <div className={s.ctaActions}>
              <a className={`btn btn-primary ${s.ctaButton}`} href={mail('KGC 2027 sponsorship')}>
                Email us
              </a>
              <a
                className={`btn btn-secondary ${s.ctaButton}`}
                href={PROSPECTUS_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                Ask for information
                <span className="sr-only"> (the sponsorship prospectus, in a new tab)</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      {bands.length > 0 && (
        <section style={{ paddingBlock: '56px 80px' }}>
          <div className="wrap">
            <h2>Previous Sponsors</h2>
            {/*
              `titles="label"`: small labels, each with its tier's metal rule,
              so the wall reads under the section heading rather than as four
              more headings. The homepage keeps the widget's own centred
              titles.
            */}
            <SponsorTiers bands={bands} titles="label" blend />
          </div>
        </section>
      )}

      {/*
        The call for speakers, moved from the top of the page to the end of it
        (T173). Seven links still land on `#speak`: the footer, search, the
        startup pitch and poster pages, the HCLS speakers card and two redirects
        from the old site. It is the only call for speakers on the site.
      */}
      <section className="band-white" style={{ paddingBlock: '0 80px' }}>
        <div className="wrap">
          <div className={`flat-block speak-box ${s.speak}`} id="speak">
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
        </div>
      </section>
    </>
  );
}

/**
 * Six photos from past conferences, chosen to show the room rather than the
 * stage: the crowd between sessions, a panel, a sponsor table, the hallway
 * track, a full hall and the networking tables. Copied from the old site's
 * uploads (WordPress backup of 2026-09-26) and resized to 1600px at most, with
 * their metadata stripped.
 */
const PHOTOS: { src: string; alt: string; position?: string }[] = [
  {
    src: '/kgc/photos/sponsor/kgc-crowd-networking-2022.jpg',
    alt: 'A packed hall of attendees talking between sessions at KGC 2022',
  },
  {
    src: '/kgc/photos/sponsor/kgc-panel-on-stage-2025.jpg',
    alt: 'A healthcare and life sciences panel on stage at KGC 2025',
  },
  {
    src: '/kgc/photos/sponsor/kgc-sponsor-booth-2025.jpg',
    alt: 'Two people at a sponsor table beside the KGC banner at KGC 2025',
    // A wide frame: anchored left so the KGC banner stays in the crop.
    position: 'left center',
  },
  {
    src: '/kgc/photos/sponsor/kgc-hallway-conversation-2025.jpg',
    alt: 'Attendees in a lively conversation around a table at KGC 2025',
  },
  {
    src: '/kgc/photos/sponsor/kgc-audience-2022.jpg',
    alt: 'A seated audience following a talk at KGC 2022',
  },
  {
    src: '/kgc/photos/sponsor/kgc-networking-tables-2025.jpg',
    alt: 'Small groups meeting at tables by the windows at KGC 2025',
  },
];

/** The full prospectus, kept by the organizers outside this site. */
const PROSPECTUS_URL =
  'https://docs.superhuman.com/d/Knowledge-Graph-Conference-Sponsorship-Prospectus_dbvrFq8v5WB/Knowledge-Graph-Conference-2027_suMDKRAQ#_lu_XTxuJ';
