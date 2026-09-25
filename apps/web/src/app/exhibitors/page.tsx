import type { Metadata } from 'next';
import Link from 'next/link';
import { listExhibitorsByZone, siteEvent } from '@/lib/data';

export const metadata: Metadata = {
  title: 'Exhibitors',
  description:
    'Who is exhibiting at the Knowledge Graph Conference 2027, and where to find them at Bryant Park, New York.',
};

/**
 * Rendered once and reused for up to a minute, rather than from scratch on
 * every visit. The hall changes when an organizer edits it, not per visitor.
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

/**
 * `/exhibitors` — the exhibition hall, publicly.
 *
 * ── Why this page exists ────────────────────────────────────────────────────
 *
 * `/tickets/exhibitor` sells "a listing attendees can find" and "your booth
 * number", and until now `exhibitors` and `booths` were read by no public
 * surface at all — the dashboard authored both and showed them to nobody. That
 * is one of the fourteen cases `AGENTS.md` counts of this project claiming a
 * capability it does not have, and it is the one with an invoice attached: it
 * was on a sales page.
 *
 * Firestore-driven and `force-dynamic`, following `/sponsor` — the closest
 * existing page, and for the same reason: an exhibitor confirmed on Tuesday
 * should be on the page on Tuesday, not at the next deploy.
 *
 * ── What is on a card, and what is deliberately not ─────────────────────────
 *
 * Name, booth number, description, logo, website. Not `contactName` or
 * `contactEmail`: those are the sales contact who signed the package, and
 * publishing a named individual's address on a page a scraper will find is a
 * decision nobody made when they typed it into the dashboard. Not
 * `passesAllocated` / `passesUsed` either, which are commercial terms.
 */
/** Up to two initials, for the tile of an exhibitor with no logo. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export default async function ExhibitorsPage() {
  const ev = await siteEvent();
  const zones = await listExhibitorsByZone();
  const total = zones.reduce((n, z) => n + z.exhibitors.length, 0);

  return (
    <>
      <section>
        <div className="wrap">
          <h1>Exhibitors at {ev.shortName} {ev.year}</h1>
          <p className="lede">
            {ev.datesLong} at {ev.venueShort}.
          </p>
        </div>
      </section>

      <section className="tint">
        <div className="wrap">
          {total === 0 ? (
            /*
              The honest empty state. A conference has an empty hall for most of
              the year, and this is what the page looks like then — the same
              treatment `/sponsor` gives an unsold tier, rather than a page that
              renders a heading over nothing.
            */
            <>
              <h2>The floor plan is still being set</h2>
              <p>
                No exhibitors are confirmed for {ev.year} yet. Booth packages are on sale now, and
                this page fills in as they are signed.
              </p>
              <p style={{ marginTop: 20 }}>
                <Link className="btn btn-primary" href="/tickets/exhibitor">
                  Exhibit at {ev.shortName}
                </Link>
              </p>
            </>
          ) : (
            <>
              <h2>
                {total} {total === 1 ? 'exhibitor' : 'exhibitors'}
              </h2>
              {zones.map((zone) => (
                /*
                  `paddingBlock: 0`: an aisle is a `<section>`, so it was
                  inheriting the page sections' own 64px top and bottom — 158px
                  between two aisles and 168px of empty tint under the last
                  row, inside a band that already sets its own spacing. The
                  stylesheet zeroed it for phones only; the same air was wrong
                  at every width. `.exhibitor-zone`'s 30px margin is the gap.
                */
                <section
                  className="exhibitor-zone"
                  key={zone.zone || 'unplaced'}
                  style={{ paddingBlock: 0 }}
                >
                  <h3 className="exhibitor-zone-title">
                    {/*
                      An exhibitor who has signed but has no space allocated yet
                      is a real, temporary state. Saying so is better than a
                      blank heading, and much better than inventing a number.
                    */}
                    {zone.zone || 'Booth to be confirmed'}
                  </h3>

                  <div className="exhibitor-grid">
                    {zone.exhibitors.map((e) => (
                      <article className="exhibitor-card" key={e.id}>
                        <div className="exhibitor-logo">
                          {e.logoURL ? (
                            /*
                              A plain `img`, exactly as `sponsor-tiers.tsx`
                              argues: `next/image` throws on any host not in
                              `images.remotePatterns`, which is empty on purpose,
                              and no exhibitor logo is self-hosted yet. Declaring
                              a third-party CDN trusted just to avoid a branch is
                              the wrong trade on a public page.
                            */
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={e.logoURL} alt={e.name} loading="lazy" />
                          ) : (
                            /* The name is the fallback, never an empty box. On a
                               phone the tile shows initials instead, because the
                               name was cut off at its edge ("Graphwis") and is
                               printed in full beside the tile anyway. */
                            <>
                              <span className="logo-fallback full">{e.name}</span>
                              <span className="logo-fallback initials" aria-hidden="true">
                                {initials(e.name)}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="exhibitor-body">
                          <h4>
                            {e.website ? (
                              <a href={e.website} target="_blank" rel="noreferrer noopener">
                                {e.name}
                              </a>
                            ) : (
                              e.name
                            )}
                          </h4>

                          {e.booths.length > 0 && (
                            <p className="exhibitor-booths">
                              {e.booths.map((b) => (
                                <span className="tag" key={b.number}>
                                  Booth {b.number}
                                  {b.size ? ` · ${b.size}` : ''}
                                </span>
                              ))}
                            </p>
                          )}

                          {e.description && <p className="exhibitor-desc">{e.description}</p>}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </div>
      </section>

      {total > 0 && (
        <section>
          {/*
            `.wrap`, not `.wrap.narrow`. Narrow centres a 760px column inside a
            full-width band, so this one began 250px to the right of the
            headings and cards above it. The paragraph keeps the measure
            `.narrow` gave it and loses the indent.
          */}
          <div className="wrap">
            <h2>Exhibit at {ev.shortName} {ev.year}</h2>
            <p style={{ maxWidth: '68ch' }}>
              Booth packages include a staffed space for the whole week and full conference passes
              for your team.
            </p>
            <p>
              <Link className="btn btn-primary" href="/tickets/exhibitor">
                See booth packages
              </Link>
            </p>
          </div>
        </section>
      )}
    </>
  );
}
