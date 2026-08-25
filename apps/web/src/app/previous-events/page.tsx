import type { Metadata } from 'next';

/**
 * The "Previous Events" menu the live site has and we did not.
 *
 * One index page linking out, rather than seven rebuilt archives. That is a
 * deliberate limit, not a shortcut: each of those pages is a different
 * conference's full site — its own speakers, schedule and sponsors, in the theme
 * that year used — and rebuilding them would mean either transcribing seven
 * editions of real programme data we do not hold, or generating seven pages of
 * plausible-looking history. The second is the failure mode this repo keeps
 * having, and past events are exactly where an invented speaker list would be
 * hardest to spot and most embarrassing.
 *
 * So the links go to the live archives, which are the real record and which the
 * conference maintains. They are marked as leaving the site.
 */

export const metadata: Metadata = {
  title: 'Previous events',
  description:
    'Every previous edition of the Knowledge Graph Conference, from 2019 onwards, with links to each archived site.',
};

const LIVE = 'https://www.knowledgegraph.tech';

/** Href and blurb per edition, in the live "Previous Events" menu's own order. */
const EDITIONS = [
  { year: 2025, href: `${LIVE}/conference-2025/`, where: 'Cornell Tech, New York City' },
  { year: 2024, href: `${LIVE}/conference-2024/`, where: 'Cornell Tech, New York City' },
  { year: 2023, href: `${LIVE}/kgc-2023-home/`, where: 'Cornell Tech, New York City' },
  { year: 2022, href: `${LIVE}/kgc-2022-home/`, where: 'Online' },
  { year: 2021, href: `${LIVE}/kgc2021/`, where: 'Online' },
  { year: 2020, href: `${LIVE}/conference-2020/`, where: 'Online' },
  { year: 2019, href: `${LIVE}/conference-2019/`, where: 'Columbia University, New York City' },
];

export default function PreviousEventsPage() {
  return (
    <section>
      <div className="wrap narrow">
        <p className="eyebrow">Archive</p>
        <h1>Previous events</h1>
        <p className="lede">
          Every edition of the Knowledge Graph Conference since 2019. Each one keeps its own site,
          with that year&apos;s speakers, programme and sponsors.
        </p>
        <p className="muted">
          These open the archived sites, which are maintained separately from this one.
        </p>

        <ul style={{ marginTop: 28, paddingLeft: 0, listStyle: 'none' }}>
          {EDITIONS.map((e) => (
            <li key={e.year} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
              <a href={e.href} target="_blank" rel="noreferrer noopener">
                <strong>KGC {e.year}</strong>
              </a>{' '}
              <span className="muted">— {e.where}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
