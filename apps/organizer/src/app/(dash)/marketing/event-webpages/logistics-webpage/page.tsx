import Link from 'next/link';
import { EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listRooms } from '@/lib/data';
import { publicUrl } from '@/lib/webpages';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Webpages › Logistics Webpage.
 *
 * Whova's logistics page is the practical block: how to get there, where to
 * park, what the wifi password is, which hotel has the room block.
 *
 * ── Ours exists, as prose, in a React file ──────────────────────────────────
 *
 * Travel and venue details are on `/about` at knowledgegraph.tech, written by
 * hand. That is not a gap in the data model — it is the deliberate trade the
 * Event Website screen names: sixteen static pages that read well and need a
 * deploy to change, rather than a generated page that reads badly and does not.
 *
 * The gap that actually matters is timing. Logistics is the content most likely
 * to change **during** the event ("Room 3 has moved", "the shuttle is now
 * hourly"), and a deploy is the wrong instrument for a Tuesday-morning
 * correction. The channel that already works for that is an Announcement, which
 * reaches phones instead of a page nobody reloads — so this screen points there
 * rather than pretending an editor exists.
 *
 * `settings/logistics` is no longer a reserved name: Virtual & Hybrid ›
 * Emergency Manager writes it and Content › Logistics Center reads it back.
 * What it does not hold is *venue notes*, and no public page reads any of it —
 * said plainly below, because a bag that exists looks like a bag that is wired.
 */
export default async function LogisticsWebpagePage() {
  await requireOrganizer();
  const rooms = await listRooms();

  // Where a visitor finds each kind of logistics answer today. Compiled by hand
  // because nothing enumerates the prose inside a static page.
  const WHERE = [
    { need: 'Venue and address', at: '/about', how: 'static page' },
    { need: 'Dates and times', at: '/agenda', how: 'live from this dashboard' },
    { need: 'Registration desk and badge', at: '/tickets', how: 'live from this dashboard' },
    { need: 'Travel, parking, hotels', at: '/about', how: 'static page' },
    { need: 'Accessibility and conduct', at: '/code-of-conduct', how: 'static page' },
    { need: 'Wifi, room changes, on-the-day corrections', at: '—', how: 'nowhere on the site' },
  ];

  return (
    <>
      <PageHeader
        title="Logistics Webpage"
        tags={<Tag color="orange" fill="outline">prose, not a form</Tag>}
        actions={
          <a href={publicUrl('/about')} target="_blank" rel="noreferrer" className="whova-btn-main">
            View /about ↗
          </a>
        }
        links={[
          <Link key="w" href="/marketing/event-website">
            Event Website
          </Link>,
          <Link key="a" href="/engagement/announcements">
            Announcements
          </Link>,
        ]}
      />

      <Banner kind="info">
        The venue is <strong>{EVENT.venue}</strong> and the practical detail is written into{' '}
        <code>/about</code> as prose. Changing it is a pull request — which is fine in March and
        wrong on the Tuesday morning. For same-day corrections use{' '}
        <Link href="/engagement/announcements">Announcements</Link>: it reaches phones, and a page
        does not.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Rooms on file', value: rooms.length, sub: 'named, and used by the agenda' },
          { label: 'Static pages carrying logistics', value: 3, sub: 'about, tickets, conduct' },
          { label: 'Editable from here', value: 0, sub: 'no logistics editor exists' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where a visitor finds each answer today</h2>
        <Table
          cols={[
            { key: 'n', label: 'What they need', className: 'cell-fill' },
            { key: 'p', label: 'Page', className: 'cell-md' },
            { key: 'h', label: 'How it is maintained', className: 'cell-md' },
          ]}
          rows={WHERE.map((w) => [
            w.need,
            w.at === '—' ? (
              <span key="p" className="muted">
                —
              </span>
            ) : (
              <a key="p" href={publicUrl(w.at)} target="_blank" rel="noreferrer">
                <code style={{ fontSize: 12 }}>{w.at}</code> ↗
              </a>
            ),
            w.how === 'nowhere on the site' ? (
              <Tag key="h" color="red" fill="outline" small>
                {w.how}
              </Tag>
            ) : w.how.startsWith('live') ? (
              <Tag key="h" color="green" fill="outline" small>
                {w.how}
              </Tag>
            ) : (
              <span key="h" className="muted" style={{ fontSize: 12 }}>
                {w.how} — needs a deploy
              </span>
            ),
          ])}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>A logistics editor.</strong> The <code>logistics</code> bag is real —{' '}
            <Link href="/virtual-and-hybrid/logistics-management/emergency-manager">
              Emergency Manager
            </Link>{' '}
            writes it and Logistics Center reads it back — but it holds an emergency card, not
            venue notes, and <em>no public page reads any of it</em>. The website would ignore
            whatever was saved here. <code>SETTINGS_REGISTER</code> in <code>@kgc/shared</code> is
            the field-by-field answer.
          </li>
          <li>
            <strong>A logistics page in the app.</strong> The five tabs are Home, Agenda, People,
            Community and Me. There is no &ldquo;Event info&rdquo; screen, so an attendee looking
            for the wifi password has nowhere in the app to look.
          </li>
          <li>
            <strong>Hotel room blocks and travel booking.</strong> Whova sells these as a partner
            integration. No booking partner is connected and none is planned.
          </li>
          <li>
            <strong>Editing the static pages from here.</strong> Same answer as Event Website: they
            are React files, and making them editable means a CMS.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
