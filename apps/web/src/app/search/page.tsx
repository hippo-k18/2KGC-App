import type { Metadata } from 'next';
import Link from 'next/link';
import { listAgenda, listPublicPages, listSpeakers, siteVisibility } from '@/lib/data';
import { POSTS } from '@/lib/posts';
import { ABOUT_MENU, formatDayHeading, localTime, NAV, NAV_MORE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Search',
  robots: { index: false },
};

/** Reads `?q=`, so every search is its own response. */
export const dynamic = 'force-dynamic';

/**
 * Pages that exist on every build, beyond the menus. The footer's own list, so
 * a page a visitor can reach by scrolling is also one they can find by name.
 */
const EXTRA_PAGES: { href: string; label: string }[] = [
  { href: '/exhibitors', label: 'Exhibitors' },
  { href: '/announcements', label: 'Announcements' },
  { href: '/documents', label: 'Documents' },
  { href: '/about', label: 'Venue and travel' },
  { href: '/sponsor#speak', label: 'Speak at KGC' },
  { href: '/call-for-posters', label: 'Poster track' },
  { href: '/startup-pitch', label: 'Startup pitch' },
  { href: '/code-of-conduct', label: 'Code of conduct' },
  { href: '/privacy', label: 'Privacy' },
];

/** Lowercase with accents folded, so `bergstrom` finds `Bergström`. */
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

/** Every word of the query appears somewhere in the fields. */
function matches(needle: string[], ...fields: (string | undefined)[]): boolean {
  const hay = fold(fields.filter(Boolean).join(' '));
  return needle.every((w) => hay.includes(w));
}

const LIMIT = 20;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  const q = raw?.trim() ?? '';
  const needle = fold(q).split(/\s+/).filter(Boolean);

  let sessions: { id: string; title: string; meta: string }[] = [];
  let speakers: { id: string; name: string; meta: string }[] = [];
  let pages: { href: string; label: string }[] = [];
  let posts: typeof POSTS = [];

  if (needle.length) {
    const [show, cms] = await Promise.all([siteVisibility(), listPublicPages()]);
    // A hidden programme is not searched, so no result leads to a page that is not there.
    const [days, people] = await Promise.all([
      show.agenda ? listAgenda() : Promise.resolve([]),
      show.speakers ? listSpeakers() : Promise.resolve([]),
    ]);
    const hiddenPaths = new Set([
      ...(show.agenda ? [] : ['/agenda']),
      ...(show.speakers ? [] : ['/speakers']),
    ]);

    sessions = days.flatMap((d) =>
      d.sessions
        .filter((s) => matches(needle, s.title, s.roomName, s.trackName, ...s.speakerNames))
        .map((s) => ({
          id: s.id,
          title: s.title,
          meta: [
            `${formatDayHeading(d.day)}, ${localTime(s.startsAtLocal)}`,
            s.roomName,
            s.speakerNames.join(', '),
          ]
            .filter(Boolean)
            .join(' · '),
        })),
    );

    speakers = people
      .filter((p) => matches(needle, p.name, p.company, p.title))
      .map((p) => ({
        id: p.id,
        name: p.name,
        meta: [p.title, p.company].filter(Boolean).join(', '),
      }));

    const menu = [...NAV, ...NAV_MORE, ...ABOUT_MENU.filter((m) => !m.external), ...EXTRA_PAGES];
    const seen = new Set<string>();
    pages = [
      ...menu.map((m) => ({ href: m.href, label: m.label })),
      ...cms.map((p) => ({ href: `/${p.slug}`, label: p.title })),
    ].filter((p) => {
      if (seen.has(p.href) || hiddenPaths.has(p.href) || !matches(needle, p.label)) return false;
      seen.add(p.href);
      return true;
    });

    posts = POSTS.filter((p) => matches(needle, p.title, p.excerpt, p.author, ...p.tags));
  }

  const total = sessions.length + speakers.length + pages.length + posts.length;

  return (
    <section>
      <div className="wrap narrow">
        <h1>Search</h1>

        <form className="site-search-form" role="search" action="/search" method="get">
          <label className="sr-only" htmlFor="site-search-page">
            Search the site
          </label>
          <input
            id="site-search-page"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search the site"
            autoComplete="off"
            autoFocus={!q}
          />
          <button type="submit" className="btn btn-primary">
            Search
          </button>
        </form>

        {q && (
          <p className="filter-summary" role="status">
            {total === 0 ? (
              <>Nothing matches “{q}”. Try a speaker’s name or a session title.</>
            ) : (
              <>
                {total} {total === 1 ? 'result' : 'results'} for “{q}”.
              </>
            )}
          </p>
        )}

        {pages.length > 0 && (
          <ResultGroup title="Pages" count={pages.length}>
            {pages.slice(0, LIMIT).map((p) => (
              <li key={p.href}>
                <Link href={p.href}>{p.label}</Link>
              </li>
            ))}
          </ResultGroup>
        )}

        {sessions.length > 0 && (
          <ResultGroup
            title="Sessions"
            count={sessions.length}
            more={{ href: `/agenda?q=${encodeURIComponent(q)}`, label: 'See them all on the agenda' }}
          >
            {sessions.slice(0, LIMIT).map((s) => (
              <li key={s.id}>
                <Link href={`/agenda/${s.id}`}>{s.title}</Link>
                <span>{s.meta}</span>
              </li>
            ))}
          </ResultGroup>
        )}

        {speakers.length > 0 && (
          <ResultGroup title="Speakers" count={speakers.length}>
            {speakers.slice(0, LIMIT).map((p) => (
              <li key={p.id}>
                {/* No page per speaker, so their sessions stand in for one. */}
                <Link href={`/agenda?q=${encodeURIComponent(p.name)}`}>{p.name}</Link>
                {p.meta && <span>{p.meta}</span>}
              </li>
            ))}
          </ResultGroup>
        )}

        {posts.length > 0 && (
          <ResultGroup title="Articles" count={posts.length}>
            {posts.slice(0, LIMIT).map((p) => (
              <li key={p.slug}>
                <Link href={`/blog/${p.slug}`}>{p.title}</Link>
                <span>{p.author}</span>
              </li>
            ))}
          </ResultGroup>
        )}
      </div>
    </section>
  );
}

function ResultGroup({
  title,
  count,
  more,
  children,
}: {
  title: string;
  count: number;
  more?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <div className="search-group">
      <h2>
        {title} <span>{count}</span>
      </h2>
      <ul>{children}</ul>
      {count > LIMIT && more && (
        <p>
          <Link href={more.href}>{more.label}</Link>
        </p>
      )}
    </div>
  );
}
