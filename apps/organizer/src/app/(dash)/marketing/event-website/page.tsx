import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { pageReadiness, publicUrl } from '@/lib/webpages';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Website.
 *
 * Whova's version builds you a hosted one-page event site. Ours is the index of
 * a site that already exists — nineteen pages at knowledgegraph.tech, three of
 * them rendered live from the data in this dashboard.
 *
 * ── The split that matters, and it is stated on screen ──────────────────────
 *
 * Three pages are **live**: change a session here and /agenda changes. Sixteen
 * are **static React files**, so editing the code of conduct is a deploy. That
 * distinction is the single most useful thing this screen can tell an organizer,
 * because it is the difference between "I can fix that now" and "I need to ask
 * somebody". Whova's page builder makes everything editable and everything
 * ugly; we have the opposite trade and should say so rather than hide it.
 */

/** The public site, as it actually is. Kept here because nothing else enumerates it. */
const STATIC_PAGES: { path: string; title: string }[] = [
  { path: '/', title: 'Home' },
  { path: '/about', title: 'About' },
  { path: '/tickets', title: 'Tickets' },
  { path: '/tickets/invoice', title: 'Invoice a company' },
  { path: '/speakers', title: 'Speakers' },
  { path: '/agenda', title: 'Agenda' },
  { path: '/sponsor', title: 'Sponsors' },
  { path: '/team', title: 'Team' },
  { path: '/community', title: 'Community' },
  { path: '/learn', title: 'Learn' },
  { path: '/hcls', title: 'HCLS' },
  { path: '/blog', title: 'Blog' },
  { path: '/previous-events', title: 'Previous events' },
  { path: '/call-for-posters', title: 'Call for posters' },
  { path: '/startup-pitch', title: 'Startup pitch' },
  { path: '/kgc-lifetime-achievement-awards', title: 'Lifetime achievement awards' },
  { path: '/code-of-conduct', title: 'Code of conduct' },
];

const LIVE = new Set(['/agenda', '/speakers', '/sponsor', '/tickets', '/tickets/invoice']);

export default async function EventWebsitePage() {
  await requireOrganizer();
  const readiness = await pageReadiness();

  const problems =
    readiness.agenda.problems.reduce((n, x) => n + x.count, 0) +
    readiness.speakers.problems.reduce((n, x) => n + x.count, 0) +
    readiness.sponsors.problems.reduce((n, x) => n + x.count, 0);

  return (
    <>
      <PageHeader
        title="Event Website"
        tags={<Tag color="blue">{STATIC_PAGES.length} pages</Tag>}
        actions={
          <a href={publicUrl('/')} target="_blank" rel="noreferrer" className="whova-btn-main">
            Open the site ↗
          </a>
        }
        links={[
          <Link key="a" href="/marketing/event-webpages/agenda-webpage/general-purpose">
            Agenda webpage
          </Link>,
          <Link key="s" href="/marketing/event-webpages/speaker-webpage">
            Speaker webpage
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Pages', value: STATIC_PAGES.length, sub: 'all reachable from the nav' },
          { label: 'Driven by this dashboard', value: LIVE.size, sub: 'change here, live there' },
          {
            label: 'Data problems',
            value: problems,
            sub: problems === 0 ? 'nothing missing' : 'visible to a visitor',
          },
        ]}
      />

      <Banner kind="info">
        <strong>KGC has a real website, not a generated one.</strong> Whova hosts a one-page event
        site on their domain; this is knowledgegraph.tech, with the conference&rsquo;s own design.
        The trade is that only the data-driven pages can be changed from here — the rest are code.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Pages</h2>
        <Table
          cols={[
            { key: 't', label: 'Page', className: 'cell-fill' },
            { key: 'p', label: 'Path', className: 'cell-md' },
            { key: 'e', label: 'Edited from', className: 'cell-md' },
          ]}
          rows={STATIC_PAGES.map((p) => [
            <a key="t" href={publicUrl(p.path)} target="_blank" rel="noreferrer">
              {p.title} ↗
            </a>,
            <code key="p" style={{ fontSize: 12 }}>
              {p.path}
            </code>,
            LIVE.has(p.path) ? (
              <Tag key="e" color="green" fill="outline" small>
                this dashboard
              </Tag>
            ) : (
              <span key="e" className="muted" style={{ fontSize: 12 }}>
                code — needs a deploy
              </span>
            ),
          ])}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Editing the sixteen static pages.</strong> They are React files, so changing the
            code of conduct is a pull request. Making them editable means a CMS —{' '}
            <code>ROADMAP.md</code> puts that in Phase 5 and it is the largest single piece of the
            website half of parity.
          </li>
          <li>
            <strong>Branding controls.</strong> Colours, logo and banner would need Storage uploads
            and an image pipeline, which no screen in this dashboard has yet.
          </li>
          <li>
            <strong>A custom domain per event.</strong> Whova&rsquo;s Branded Event URL. We have one
            domain and one event a year.
          </li>
          <li>
            <strong>Traffic analytics.</strong> Nothing measures visits. Adding a tracker is a
            privacy decision, not a missing feature.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
