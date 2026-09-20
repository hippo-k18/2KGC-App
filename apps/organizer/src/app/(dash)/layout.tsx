import Link from 'next/link';
import { COLLECTIONS, EVENT, publicSiteOrigin } from '@kgc/shared';
import { requireAccess } from '@/lib/auth';
import { adoptionCounts, countWhereEvent, listSessions } from '@/lib/data';
import { eventBasics } from '@/lib/event';
import { ChevronIcon } from '@/lib/icons';
import { IMPLEMENTED, NAV, allPaths, searchIndex, type NavNode } from '@/lib/nav';
import { canOpen } from '@/lib/team-core';
import { logoutAction } from '../login/actions';
import { Sidebar, TopNav, type SlimNode } from './dash-nav';
import { FeatureSearch } from './feature-search';
import { LiveStats } from './live-stats';
import { Dropdown } from './menu';

export const dynamic = 'force-dynamic';

/**
 * Where the Preview menu points.
 *
 * Both links were hard-coded to localhost — `:8081` for the app and `:3000` for
 * the ticket page, the latter not even the port `apps/web` runs on. On the
 * deployed dashboard they were two dead links in the most prominent menu in the
 * chrome, and an organizer clicking Preview is precisely someone checking that
 * the public side works.
 *
 * The website's half is `publicSiteOrigin()` from `@kgc/shared` — the one
 * declaration every link this project mints resolves through, so the Preview
 * menu cannot point somewhere different from the confirmation emails.
 *
 * The attendee app has no equivalent, so it keeps its own variable below and
 * its own dev-port default: Expo is right locally and wrong on the deployed
 * dashboard, which is the trade the website's default deliberately refuses.
 */
function appOrigin(): string {
  return (process.env.APP_PUBLIC_ORIGIN ?? 'http://localhost:8081').replace(/\/$/, '');
}

/**
 * Whova's authenticated shell.
 *
 * Four bands, in their order: a full-bleed dark utility bar; an event masthead
 * carrying the name, the dates,
 * the status pill and the preview/report buttons; a nine-tab strip; then a
 * 200px left rail beside the content. All three sit inside the same 1060px
 * centred box, which is why the page has visible grey margins on a wide screen
 * — that is Whova's `.layout-boxed`, not an oversight.
 *
 * The masthead's two right-hand stat cards are 232×84 in Whova and show live
 * numbers. Ours show the two counts that actually matter in the weeks before
 * doors open: how many imported tickets exist, and how many of those people
 * have signed in and made a profile. The gap between them is the number an
 * organizer watches.
 *
 * This layout gate is convenience, not security — server actions are separately
 * addressable endpoints and each calls `requireOrganizer()` for itself. The
 * same goes for roles: the rail and the tab strip below leave out what a team
 * member cannot open, and the refusal itself is in `requireAccess()`.
 */

/**
 * The tree, less whatever `open` refuses. A branch survives when it can be
 * opened itself or when anything beneath it can, so a check-in account keeps
 * Attendees › Check-in & Checkout and loses the other eight tabs.
 */
function slim(nodes: NavNode[], open: (path: string) => boolean, prefix = ''): SlimNode[] {
  return nodes.flatMap((n) => {
    const path = prefix ? `${prefix}/${n.slug}` : n.slug;
    const children = n.children ? slim(n.children, open, path) : undefined;
    if (!open(path) && !children?.length) return [];
    return {
      name: n.name,
      title: n.title,
      slug: n.slug,
      widthClass: n.widthClass,
      tag: n.tag,
      tagLabel: n.tagLabel,
      implemented: IMPLEMENTED.has(path),
      children,
    };
  });
}

function prettyDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const { email: actor, roles } = await requireAccess();
  const open = (path: string) => canOpen(roles, path);
  const [basics, sessions, adoption, announcements, posts, speakers, sponsors] = await Promise.all([
    eventBasics(),
    listSessions(),
    adoptionCounts(),
    countWhereEvent(COLLECTIONS.announcements),
    countWhereEvent(COLLECTIONS.communityPosts),
    countWhereEvent(COLLECTIONS.speakers),
    countWhereEvent(COLLECTIONS.sponsors),
  ]);
  const { registrations, users, signedIn } = adoption;

  const days = [...new Set(sessions.map((s) => s.day))].sort();
  /* The dates saved on Content > Basics lead; with none saved, the agenda's own span. */
  const dateRange = basics.datesSaved
    ? basics.datesShort
    : days.length === 0
      ? 'no sessions scheduled'
      : days.length === 1
        ? prettyDay(days[0])
        : `${prettyDay(days[0])} – ${prettyDay(days[days.length - 1])}`;

  const published = sessions.filter((s) => s.status === 'published').length;
  const nav = slim(NAV, open);
  // For the rail's fixed links, which are not in the tree. Null for an owner,
  // so the common case ships no list at all.
  const allowed = roles.includes('owner')
    ? null
    : allPaths().filter(open).map((p) => `/${p}`);

  return (
    <>
      <header id="main-header">
        <div className="main-header">
          <Link className="logo" href="/">
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size chrome in a server component; next/image adds a client runtime and buys nothing. */}
            <img className="logo-mark" src="/kgc/wordmark-white.png" alt={basics.shortName} />
            <span className="logo-project">EMS</span>
          </Link>
          <nav className="header-links">
            <a href={EVENT.website} target="_blank" rel="noreferrer">
              Event website
            </a>
            {open('tools') ? <Link href="/tools">Help Center</Link> : null}
            {open('') ? <Link href="/">My Events</Link> : null}
            <span className="user-name">{actor}</span>
            <form action={logoutAction} style={{ display: 'inline-flex' }}>
              <button type="submit" className="header-signout">
                Sign out
              </button>
            </form>
          </nav>
          <FeatureSearch entries={searchIndex().filter((e) => open(e.path))} />
        </div>
      </header>

      <div id="top-event-name" className="layout-boxed">
        <div className="event-title">
          <span className="event-name">{basics.name}</span>
          <span className="event-status-badge badge-alert">Draft</span>
        </div>

        <div className="buttons-cards">
          <div className="buttons">
            <div className="additional-info">
              {dateRange} | {basics.venue} |{' '}
              <a className="tutorial-video" href={EVENT.website} target="_blank" rel="noreferrer">
                <u>Event website</u>
              </a>
              |{' '}
              <span className="event-status-badge badge-info">{basics.eventTypeLabel}</span>
              <span className="event-status-badge badge-alert">App: draft</span>
              <span className="event-status-badge badge-alert">Tickets: draft</span>
            </div>

            <div className="guide-info">
              {open('publish') ? (
                <Link className="btn btn-primary" href="/publish">
                  Step-by-step setup guide
                </Link>
              ) : null}
              <Dropdown
                label="Preview"
                className="btn btn-default event-title-btn"
                items={[
                  { label: 'Web App', href: appOrigin() },
                  {
                    label: 'Mobile App',
                    disabled: true,
                  },
                  { label: 'Attendee Registration Page', href: `${publicSiteOrigin()}/tickets` },
                ]}
              />
              {open('tools/report') ? (
                <Link className="btn btn-default event-title-btn" href="/tools/report">
                  Report
                </Link>
              ) : null}
            </div>
          </div>

          {/*
            Phone only: the two cards and the Live Event Stats band sit behind
            this, closed, so the screen's own content starts on the first screen.
            A checkbox rather than state because the band is a sibling further
            down the page and this file is a server component; the CSS reads it
            with `:has()`. Hidden at 768px and wider.
          */}
          <input type="checkbox" id="stats-open" className="stats-toggle-input" />
          <label htmlFor="stats-open" className="stats-toggle">
            <span>Event stats</span>
            <ChevronIcon open={false} />
          </label>

          <div className="cards">
            <div className="widget-card">
              <div className="widget-label">Registrations</div>
              <div className="widget-value">{registrations}</div>
              {/*
                `signedIn` is the count of *registrations* whose holder has a
                profile, not the count of profiles: `users` includes organizers,
                staff and comped speakers who hold no ticket, so dividing it by
                the ticket count produced the 102% this card used to show. The
                numerator is now filtered out of the denominator's own query and
                the two agree with the Attendees screen, which joins the same
                two collections on the same address.
              */}
              <div className="widget-sub">
                {signedIn} have signed in (
                {registrations === 0 ? 0 : Math.round((signedIn / registrations) * 100)}%)
              </div>
            </div>
            <div className="widget-card">
              <div className="widget-label">Agenda</div>
              <div className="widget-value">{sessions.length}</div>
              <div className="widget-sub">
                {published} published across {days.length} day{days.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <TopNav nav={nav} draftTabs={['tickets', 'publish']} />

      <LiveStats
        viewAll={open('tools/report')}
        stats={[
          { label: 'Signed in', value: users, href: '/attendees/manage-attendees/attendees' },
          { label: 'Registered', value: registrations, href: '/attendees/check-in-and-checkout/check-in' },
          { label: 'Sessions', value: sessions.length, href: '/content/agenda-center/session-manager' },
          { label: 'Speakers', value: speakers, href: '/content/speaker-center/speaker-manager' },
          { label: 'Sponsors', value: sponsors, href: '/content/sponsor-center/sponsor-manager' },
          { label: 'Posts', value: posts },
          { label: 'Announcements', value: announcements, href: '/engagement/announcements' },
        ].map((stat) => (stat.href && !open(stat.href) ? { ...stat, href: undefined } : stat))}
      />

      <div className="layout-boxed frame-wrapper">
        <Sidebar
          nav={nav}
          allowed={allowed}
          footnote={`${basics.shortName} Event Management System`}
        />
        <div className="frame-right-side">{children}</div>
      </div>

      <footer className="main-footer">
        <strong>{basics.shortName} EMS</strong>. The event management system for{' '}
        {basics.name}.
      </footer>
    </>
  );
}
