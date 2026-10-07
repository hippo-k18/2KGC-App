import Link from 'next/link';
import { PastSpeakerSearch } from '@/components/past-speaker-search';
import { fold, PAST_SPEAKERS, PAST_YEARS, pastSpeakersFor, type PastSpeaker, type PastYear } from '@/lib/past-speakers';

/** Initials for a speaker with no photo. Two at most. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** The first two rows load eagerly; one of them is the largest thing on screen. */
const EAGER = 10;

export function PastSpeakerCard({ speaker: s, eager }: { speaker: PastSpeaker; eager?: boolean }) {
  return (
    <li className="ps-card" data-search={fold(`${s.name} ${s.company ?? ''} ${s.title ?? ''}`)}>
      {s.photo ? (
        // A plain <img>: the photos are already cut to size by the import, so
        // there is nothing for the image optimizer to do but spend memory.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="ps-photo"
          src={s.photo}
          alt=""
          width={s.photoWidth ?? 400}
          height={s.photoHeight ?? 400}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
        />
      ) : (
        <span className="ps-photo is-fallback" aria-hidden="true">
          {initials(s.name)}
        </span>
      )}
      <h2 className="ps-name">
        {/* The whole card is the link (see `.ps-name a::after`). */}
        <Link href={`/past-speakers/${s.slug}`}>{s.name}</Link>
      </h2>
      {s.company ? <p className="ps-org">{s.company}</p> : null}
      {s.years.length ? <p className="ps-years">{s.years.join(' · ')}</p> : null}
      {s.photo && s.photoCredit ? <p className="ps-credit">{s.photoCredit}</p> : null}
    </li>
  );
}

/**
 * `/past-speakers` and `/past-speakers?year=<year>`: the banner, the year links, a
 * search box and the grid.
 *
 * Every card is in the server render, so all 348 pages are linked from a page
 * a crawler can read and the grid works with scripts off. The search box only
 * hides cards that do not match.
 */
export function PastSpeakerDirectory({ year }: { year?: PastYear }) {
  const speakers = pastSpeakersFor(year);
  const heading = year ? `KGC ${year.year} speakers` : 'Past speakers';
  const lede = year
    ? `${speakers.length} people spoke at the Knowledge Graph Conference in ${year.year}.`
    : `Everyone who spoke at the Knowledge Graph Conference from ${PAST_YEARS.at(-1)?.year} to ${PAST_YEARS[0]?.year}: ${PAST_SPEAKERS.length} people.`;

  return (
    <>
      <section className="about-hero about-hero-plain ps-hero">
        <div className="wrap-kgc">
          <h1>{heading}</h1>
          <p className="ps-lede">{lede}</p>
        </div>
      </section>

      <section className="ps-band">
        <div className="wrap-kgc">
          <div className="ps-toolbar">
            <nav className="ps-years-nav" aria-label="Year">
              <Link href="/past-speakers" aria-current={year ? undefined : 'page'}>
                All years
              </Link>
              {PAST_YEARS.map((y) => (
                <Link
                  key={y.year}
                  href={`/past-speakers?year=${y.year}`}
                  aria-current={year?.year === y.year ? 'page' : undefined}
                >
                  {y.year}
                </Link>
              ))}
            </nav>
            <PastSpeakerSearch key={year?.year ?? "all"} total={speakers.length} />
          </div>

          <ul className="ps-grid" id="ps-grid">
            {speakers.map((s, i) => (
              <PastSpeakerCard key={s.slug} speaker={s} eager={i < EAGER} />
            ))}
          </ul>
          <p className="notice ps-none" id="ps-none" hidden>
            No speaker matches that search.
          </p>
        </div>
      </section>
    </>
  );
}
