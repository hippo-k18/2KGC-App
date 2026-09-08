import Link from 'next/link';
import { PAGE_CONTENT_KEYS, type PageContentKey } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { readPageContentMeta } from '@/lib/page-content';
import { pageReadiness, publicUrl } from '@/lib/webpages';
import { GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Website.
 *
 * Whova's version builds you a hosted one-page event site. Ours is the index of
 * a site that already exists at knowledgegraph.tech — and the useful thing this
 * screen can tell an organizer is not "here are the pages" but **which of them
 * they can change themselves, and where**.
 *
 * ── Three maintenance states, not two ───────────────────────────────────────
 *
 * This screen carried two for months — "this dashboard" or "code, needs a
 * deploy" — and the second was wrong for three pages. `pageContent` is a real
 * store with a real editor at Content › Basics › Website Copy, and
 * `/code-of-conduct`, `/call-for-posters` and `/startup-pitch` read it on every
 * request. Filing them under "needs a deploy" sent an organizer to open a pull
 * request for a reporting address they could have changed in a text box, which
 * is the exact cost of a stale classification.
 *
 * The inventory below was also short by five pages — `/exhibitors`,
 * `/documents`, `/announcements` and the two audience ticket pages had all
 * shipped since the list was typed. A hand-kept list of routes goes stale
 * silently, so the states are what the screen is really about; the count is a
 * by-product.
 */

type Maintenance =
  /** Rendered from Firestore on every request. Change it here, it changes there. */
  | 'data'
  /** Prose, but its fields that go stale are in `pageContent` and editable here. */
  | 'copy'
  /** A React file. Changing a word is a pull request. */
  | 'code';

interface SitePage {
  path: string;
  title: string;
  how: Maintenance;
  /** For a `copy` page, the `pageContent` document behind it. */
  key?: PageContentKey;
  /** For a `data` page, what it reads — named so the row says where to go. */
  source?: string;
}

/**
 * The public site, as it actually is.
 *
 * Kept here because nothing else enumerates it: `apps/web` is a separate install
 * this one may not import, and its routes are files rather than a table. The two
 * dynamic routes (`/blog/[slug]`, `/order/[token]`) are deliberately absent —
 * they are not pages an organizer navigates to.
 */
const SITE_PAGES: SitePage[] = [
  { path: '/', title: 'Home', how: 'code' },
  { path: '/about', title: 'About', how: 'code' },
  { path: '/tickets', title: 'Tickets', how: 'data', source: 'ticketTypes' },
  { path: '/tickets/invoice', title: 'Invoice a company', how: 'data', source: 'ticketTypes' },
  { path: '/tickets/exhibitor', title: 'Exhibitor packages', how: 'data', source: 'ticketTypes' },
  { path: '/tickets/sponsor', title: 'Sponsorship', how: 'data', source: 'ticketTypes' },
  { path: '/agenda', title: 'Agenda', how: 'data', source: 'sessions' },
  { path: '/speakers', title: 'Speakers', how: 'data', source: 'speakers' },
  { path: '/sponsor', title: 'Sponsors', how: 'data', source: 'sponsors' },
  { path: '/exhibitors', title: 'Exhibitors', how: 'data', source: 'exhibitors' },
  { path: '/documents', title: 'Documents', how: 'data', source: 'documents' },
  { path: '/announcements', title: 'Announcements', how: 'data', source: 'announcements' },
  {
    path: '/code-of-conduct',
    title: 'Code of conduct',
    how: 'copy',
    key: PAGE_CONTENT_KEYS.codeOfConduct,
  },
  {
    path: '/call-for-posters',
    title: 'Call for posters',
    how: 'copy',
    key: PAGE_CONTENT_KEYS.callForPosters,
  },
  {
    path: '/startup-pitch',
    title: 'Startup pitch',
    how: 'copy',
    key: PAGE_CONTENT_KEYS.startupPitch,
  },
  { path: '/team', title: 'Team', how: 'code' },
  { path: '/community', title: 'Community', how: 'code' },
  { path: '/learn', title: 'Learn', how: 'code' },
  { path: '/hcls', title: 'HCLS', how: 'code' },
  { path: '/blog', title: 'Blog', how: 'code' },
  { path: '/previous-events', title: 'Previous events', how: 'code' },
  {
    path: '/kgc-lifetime-achievement-awards',
    title: 'Lifetime achievement awards',
    how: 'code',
  },
];

const WEBSITE_COPY = '/content/basics/website-copy';

/** Where a `data` page is edited, so the row is a link rather than a noun. */
const EDITOR_FOR: Record<string, { href: string; label: string }> = {
  sessions: { href: '/content/agenda-center/session-manager', label: 'Session Manager' },
  speakers: { href: '/content/speaker-center/speaker-manager', label: 'Speaker Manager' },
  sponsors: { href: '/content/sponsor-center/sponsor-manager', label: 'Sponsor Manager' },
  exhibitors: { href: '/content/exhibitor-center/exhibitor-manager', label: 'Exhibitor Manager' },
  documents: { href: '/content/documents-and-videos/documents', label: 'Documents' },
  announcements: { href: '/engagement/announcements', label: 'Announcements' },
  ticketTypes: { href: '/tickets/ticket-setup/1-1-create-tickets', label: 'Create Tickets' },
};

export default async function EventWebsitePage() {
  await requireOrganizer();

  const copyPages = SITE_PAGES.filter((p) => p.key);

  const [readiness, copyMeta] = await Promise.all([
    pageReadiness(),
    Promise.all(copyPages.map((p) => readPageContentMeta(p.key!))),
  ]);

  /*
   * `readPageContentMeta` returns nothing for a document stamped with another
   * edition's `eventId`, so an absent `updatedAt` reads as "never confirmed for
   * this event" rather than "never written" — which is the state that matters,
   * because the page then renders its own compiled-in constant.
   */
  const savedAt = new Map(copyPages.map((p, i) => [p.path, copyMeta[i].updatedAt]));
  const confirmed = copyPages.filter((p) => savedAt.get(p.path)).length;

  const problems =
    readiness.agenda.problems.reduce((n, x) => n + x.count, 0) +
    readiness.speakers.problems.reduce((n, x) => n + x.count, 0) +
    readiness.sponsors.problems.reduce((n, x) => n + x.count, 0);

  const editable = SITE_PAGES.filter((p) => p.how !== 'code').length;

  return (
    <>
      <PageHeader
        title="Event Website"
        info={
          <>
            <strong>A real site, not a generated one</strong>
            <p>
              knowledgegraph.tech is the conference&rsquo;s own design, so there is no page builder
              and no embed snippet. The trade is that the pages marked <em>code</em> below need a
              deploy to change; everything else is editable from this dashboard.
            </p>
          </>
        }
        tags={<Tag color="blue">{SITE_PAGES.length} pages</Tag>}
        actions={
          <a href={publicUrl('/')} target="_blank" rel="noreferrer" className="whova-btn-main">
            Open the site ↗
          </a>
        }
        links={[
          <Link key="c" href={WEBSITE_COPY}>
            Website Copy
          </Link>,
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
          { label: 'Pages', value: SITE_PAGES.length, sub: 'all reachable from the nav' },
          {
            label: 'Editable from here',
            value: editable,
            sub: `${SITE_PAGES.length - editable} are code`,
          },
          {
            label: 'Copy confirmed',
            value: `${confirmed}/${copyPages.length}`,
            sub: confirmed === copyPages.length ? 'saved for this edition' : 'not inputted yet',
          },
          {
            label: 'Data problems',
            value: problems,
            sub: problems === 0 ? 'nothing missing' : 'visible to a visitor',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Pages</h2>
        <Table
          cols={[
            { key: 't', label: 'Page', className: 'cell-fill' },
            { key: 'p', label: 'Path', className: 'cell-md' },
            { key: 'e', label: 'Edited from', className: 'cell-md' },
          ]}
          rows={SITE_PAGES.map((p) => {
            const editor = p.source ? EDITOR_FOR[p.source] : undefined;
            const at = savedAt.get(p.path);
            return [
              <a key="t" href={publicUrl(p.path)} target="_blank" rel="noreferrer">
                {p.title} ↗
              </a>,
              <code key="p" style={{ fontSize: 12 }}>
                {p.path}
              </code>,
              p.how === 'data' ? (
                <span key="e" style={{ fontSize: 12 }}>
                  <Tag color="green" fill="outline" small>
                    live
                  </Tag>{' '}
                  {editor ? <Link href={editor.href}>{editor.label}</Link> : p.source}
                </span>
              ) : p.how === 'copy' ? (
                <span key="e" style={{ fontSize: 12 }}>
                  <Tag color="blue" fill="outline" small>
                    copy
                  </Tag>{' '}
                  <Link href={WEBSITE_COPY}>Website Copy</Link>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {at ? `saved ${at.slice(0, 10)}` : 'not inputted yet. Using the built-in text'}
                  </div>
                </span>
              ) : (
                <span key="e" className="muted" style={{ fontSize: 12 }}>
                  code. Needs a deploy
                </span>
              ),
            ];
          })}
        />
        {/*
          The three states are the whole point of the table, so they are named
          once underneath it rather than left to the colour of a tag.
        */}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
          <strong>live</strong>. Rendered from Firestore on every request, so a change here shows
          there immediately. <strong>copy</strong>. Prose, but the fields that go stale each
          edition are saved in Website Copy. <strong>code</strong>. A React file; changing a word
          is a pull request.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Editing the nine code pages.</strong> Most of them are layout rather than text —{' '}
            <code>/about</code> is five hand-measured bands — so storing them as strings loses the
            design and storing them as HTML makes a text box a script-injection point on a public
            page. <code>packages/shared/src/page-content.ts</code> argues this out.
          </li>
          <li>
            <strong>Branding controls.</strong> Colours, logo and banner. The Storage bucket exists
            now, so this is a rendering question — nothing in <code>apps/web</code> reads settings
            at request time — rather than an upload one.
          </li>
          <li>
            <strong>A custom domain per event.</strong> Whova&rsquo;s Branded Event URL. We have one
            domain and one event a year.
          </li>
          <li>
            <strong>Traffic analytics.</strong> Only tracked links are counted; see Listing Traffic
            Analytics. Adding a page tracker is a privacy decision, not a missing feature.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
