import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LinkedIn } from '@/components/linkedin-icon';
import { PastSpeakerDirectory } from '@/components/past-speaker-directory';
import { canonicalOrigin, jsonLdScript } from '@/lib/event-jsonld';
import {
  archiveHref,
  PAST_SPEAKERS,
  PAST_YEARS,
  pastSpeaker,
  pastSpeakerDescription,
  pastYear,
  roleLine,
  type PastSpeaker,
  type PastTalk,
} from '@/lib/past-speakers';

/**
 * One past speaker, or one year's list.
 *
 * A year's list is addressed as `/past-speakers?year=2022`: `next.config.ts`
 * rewrites that to `/past-speakers/2022` here, so it is built at deploy time
 * like every speaker page. Asked for directly, `/past-speakers/2022` is sent to
 * the query form by the middleware, so each list has one address. No slug is
 * four digits (`past-speakers.test.ts`), and any other address is a 404.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return [...PAST_YEARS.map((y) => ({ slug: String(y.year) })), ...PAST_SPEAKERS.map((s) => ({ slug: s.slug }))];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const year = pastYear(slug);
  if (year) {
    return {
      title: { absolute: `KGC ${year.year} speakers · Knowledge Graph Conference` },
      description: `The ${year.slugs.length} people who spoke at the Knowledge Graph Conference in ${year.year}, with their biographies and talks.`,
      alternates: { canonical: `/past-speakers?year=${year.year}` },
    };
  }
  const s = pastSpeaker(slug);
  if (!s) return {};
  const description = pastSpeakerDescription(s);
  return {
    title: { absolute: `${s.name} · KGC speaker` },
    description,
    alternates: { canonical: `/past-speakers/${s.slug}` },
    openGraph: {
      type: 'profile',
      title: `${s.name} · KGC speaker`,
      description,
      url: `/past-speakers/${s.slug}`,
      images: s.photo ? [s.photo] : undefined,
    },
  };
}

export default async function PastSpeakerRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const year = pastYear(slug);
  if (year) return <PastSpeakerDirectory year={year} />;
  const s = pastSpeaker(slug);
  if (!s) notFound();
  return <PastSpeakerPage speaker={s} />;
}

/** schema.org Person, so a search engine can tie the page to the person. */
function personJsonLd(s: PastSpeaker) {
  const origin = canonicalOrigin();
  const sameAs = [s.links.linkedin, s.links.twitter, s.links.website].filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: s.name,
    url: `${origin}/past-speakers/${s.slug}`,
    ...(s.photo ? { image: `${origin}${s.photo}` } : {}),
    ...(s.title ? { jobTitle: s.title } : {}),
    ...(s.company ? { worksFor: { '@type': 'Organization', name: s.company } } : {}),
    description: pastSpeakerDescription(s),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

function PastSpeakerPage({ speaker: s }: { speaker: PastSpeaker }) {
  const role = roleLine(s);
  // Newest year first, and within a year in the export's order. Talks with no
  // year come last, under no year label.
  const groups = [...new Set(s.talks.map((t) => t.year))]
    .sort((a, b) => (b ?? 0) - (a ?? 0))
    .map((year) => ({ year, talks: s.talks.filter((t) => t.year === year) }));
  const hasLinks = !!(s.links.linkedin || s.links.twitter || s.links.website);

  return (
    <section className="ps-profile">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(personJsonLd(s)) ?? '' }}
      />
      <div className="wrap narrow">
        <p className="ps-crumb">
          <Link href="/past-speakers">Past speakers</Link>
        </p>

        <div className="ps-head">
          {s.photo ? (
            <figure className="ps-head-figure">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="ps-head-photo"
                src={s.photo}
                alt={s.name}
                width={s.photoWidth ?? 400}
                height={s.photoHeight ?? 400}
                fetchPriority="high"
              />
              {s.photoCredit ? <figcaption className="ps-credit">{s.photoCredit}</figcaption> : null}
            </figure>
          ) : null}
          <div>
            <h1>{s.name}</h1>
            {role ? <p className="ps-role">{role}</p> : null}
            {s.years.length ? (
              <p className="ps-spoke">
                Spoke at{' '}
                {s.years.map((y, i) => (
                  <span key={y}>
                    {i > 0 ? (i === s.years.length - 1 ? ' and ' : ', ') : null}
                    <Link href={`/past-speakers/${y}`}>KGC {y}</Link>
                  </span>
                ))}
              </p>
            ) : null}
            {hasLinks ? (
              <p className="ps-links">
                {s.links.linkedin ? <LinkedIn href={s.links.linkedin} /> : null}
                {s.links.twitter ? (
                  <a href={s.links.twitter} target="_blank" rel="noreferrer">
                    X
                  </a>
                ) : null}
                {s.links.website ? (
                  <a href={s.links.website} target="_blank" rel="noreferrer">
                    Website
                  </a>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>

        {s.bioHtml.trim() ? (
          <>
            <h2 className="ps-h2">Biography</h2>
            {/* Cut down to a short list of tags by the export and held to it by
                `past-speakers.test.ts`. It is committed data, never user input. */}
            <div className="ps-bio" dangerouslySetInnerHTML={{ __html: s.bioHtml }} />
          </>
        ) : null}

        {groups.length ? (
          <>
            <h2 className="ps-h2">Talks</h2>
            <div className="ps-talks">
              {groups.map((g) => (
                <div key={g.year ?? 'none'} className="ps-talk-year">
                  {g.year ? <p className="ps-talk-label">KGC {g.year}</p> : null}
                  {g.talks.map((t, i) => (
                    <Talk key={`${t.title ?? ''}-${i}`} talk={t} />
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : null}

        <p className="ps-next">
          Speaking at KGC 2027? <Link href="/agenda">See the agenda</Link>
        </p>
      </div>
    </section>
  );
}

/** A talk: its title (linked to the archive copy of its session page, when it
    had one), a link to the recording, and the abstract. A talk the old page
    gave no title is the recording alone. */
function Talk({ talk: t }: { talk: PastTalk }) {
  const href = archiveHref(t.url);
  const watch = t.videoUrl ? (
    <a href={t.videoUrl} target="_blank" rel="noreferrer">
      {t.title ? 'Watch' : 'Watch the recording'}
      {t.title ? <span className="sr-only"> {t.title}</span> : null}
    </a>
  ) : null;
  return (
    <div className="ps-talk">
      <p className="ps-talk-title">
        {t.title ? (
          href ? (
            <a href={href} target="_blank" rel="noreferrer">
              {t.title}
            </a>
          ) : (
            <strong>{t.title}</strong>
          )
        ) : null}
        {t.title && watch ? ' · ' : null}
        {watch}
      </p>
      {t.descriptionHtml ? (
        /* The same tag list as the biography, checked by the same test. */
        <div className="ps-talk-desc" dangerouslySetInnerHTML={{ __html: t.descriptionHtml }} />
      ) : null}
    </div>
  );
}
