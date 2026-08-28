import Link from 'next/link';
import { COLLECTIONS, EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { adoptionCounts, countWhereEvent, listSessions } from '@/lib/data';
import { IMPLEMENTED, NAV, counts, searchIndex, type NavNode } from '@/lib/nav';
import { logoutAction } from '../login/actions';
import { Sidebar, TopNav, type SlimNode } from './dash-nav';
import { FeatureSearch } from './feature-search';
import { LiveStats } from './live-stats';
import { Dropdown } from './menu';

export const dynamic = 'force-dynamic';

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
 * addressable endpoints and each calls `requireOrganizer()` for itself.
 */

function slim(nodes: NavNode[], prefix = ''): SlimNode[] {
  return nodes.map((n) => {
    const path = prefix ? `${prefix}/${n.slug}` : n.slug;
    return {
      name: n.name,
      title: n.title,
      slug: n.slug,
      widthClass: n.widthClass,
      tag: n.tag,
      tagLabel: n.tagLabel,
      implemented: IMPLEMENTED.has(path),
      children: n.children ? slim(n.children, path) : undefined,
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
  const actor = await requireOrganizer();
  const [sessions, adoption, announcements, posts, speakers, sponsors] = await Promise.all([
    listSessions(),
    adoptionCounts(),
    countWhereEvent(COLLECTIONS.announcements),
    countWhereEvent(COLLECTIONS.communityPosts),
    countWhereEvent(COLLECTIONS.speakers),
    countWhereEvent(COLLECTIONS.sponsors),
  ]);
  const { registrations, users, signedIn } = adoption;

  const days = [...new Set(sessions.map((s) => s.day))].sort();
  const dateRange =
    days.length === 0
      ? 'no sessions scheduled'
      : days.length === 1
        ? prettyDay(days[0])
        : `${prettyDay(days[0])} – ${prettyDay(days[days.length - 1])}`;

  const published = sessions.filter((s) => s.status === 'published').length;
  const { implemented, total } = counts();
  const nav = slim(NAV);

  return (
    <>
      <header id="main-header">
        <div className="main-header">
          <Link className="logo" href="/">
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size chrome in a server component; next/image adds a client runtime and buys nothing. */}
            <img className="logo-mark" src="/kgc/wordmark-white.png" alt={EVENT.shortName} />
            <span className="logo-project">EMS</span>
          </Link>
          <FeatureSearch entries={searchIndex()} />
          <nav className="header-links">
            <a href={EVENT.website} target="_blank" rel="noreferrer">
              Event website
            </a>
            <Link href="/tools">Help Center</Link>
            <Link href="/">My Events</Link>
            <span className="user-name">{actor}</span>
            <form action={logoutAction} style={{ display: 'inline-flex' }}>
              <button
                type="submit"
                style={{
                  background: 'none',
                  border: 0,
                  color: '#fff',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  lineHeight: '50px',
                  padding: '0 15px',
                }}
              >
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>

      <div id="top-event-name" className="layout-boxed">
        <div className="event-title">
          <span className="event-name">{EVENT.name}</span>
          <span className="event-status-badge badge-alert">Draft</span>
        </div>

        <div className="buttons-cards">
          <div className="buttons">
            <div className="additional-info">
              {dateRange} | {EVENT.venue} |{' '}
              <a className="tutorial-video" href={EVENT.website} target="_blank" rel="noreferrer">
                <u>Event website</u>
              </a>
              |{' '}
              <span className="event-status-badge badge-info">In-person event</span>
              <span className="event-status-badge badge-alert">App: draft</span>
              <span className="event-status-badge badge-alert">Tickets: draft</span>
            </div>

            <div className="guide-info">
              <Link className="btn btn-primary" href="/publish">
                Step-by-step setup guide
              </Link>
              <Dropdown
                label="Preview"
                className="btn btn-default event-title-btn"
                items={[
                  { label: 'Web App', href: 'http://localhost:8081' },
                  {
                    label: 'Mobile App',
                    disabled: true,
                  },
                  { label: 'Attendee Registration Page', href: 'http://localhost:3000/tickets' },
                ]}
              />
              <Link className="btn btn-default event-title-btn" href="/tools/report">
                Report
              </Link>
            </div>
          </div>

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
        stats={[
          { label: 'Signed in', value: users, href: '/attendees/manage-attendees/attendees' },
          { label: 'Registered', value: registrations, href: '/attendees/check-in-and-checkout/check-in' },
          { label: 'Sessions', value: sessions.length, href: '/content/agenda-center/session-manager' },
          { label: 'Speakers', value: speakers, href: '/content/speaker-center/speaker-manager' },
          { label: 'Sponsors', value: sponsors, href: '/content/sponsor-center/sponsor-manager' },
          { label: 'Posts', value: posts },
          { label: 'Announcements', value: announcements, href: '/engagement/announcements' },
        ]}
      />

      <div className="layout-boxed frame-wrapper">
        <Sidebar
          nav={nav}
          footnote={`${implemented} of ${total} screens are real. The rest name the gap rather than fake it — open one to see what it would take.`}
        />
        <div className="frame-right-side">{children}</div>
      </div>

      <footer className="main-footer">
        <strong>{EVENT.shortName} EMS</strong> — an organizer dashboard rebuilt one-to-one against
        Whova&apos;s, on KGC&apos;s own Firestore. {implemented} of {total} screens carry real data.
      </footer>
    </>
  );
}
