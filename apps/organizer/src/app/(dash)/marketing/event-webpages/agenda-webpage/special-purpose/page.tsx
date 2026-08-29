import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSessions, listTracks } from '@/lib/data';
import { publicUrl } from '@/lib/webpages';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Webpages › Agenda Webpage › Special-Purpose.
 *
 * Whova's special-purpose agenda is a second hosted page holding a filtered
 * slice of the programme — one track for a partner to embed, or one day for a
 * pre-conference workshop. It is a separate page because Whova has no other way
 * to express a filter: their hosted pages take no parameters.
 *
 * Ours does. `/agenda` renders the whole programme with the filter already in
 * the page, so a slice is a query string, not a second page — which means the
 * useful thing this screen can do is tell an organizer which slices exist and
 * how big each one is, so they know what a partner would actually receive.
 *
 * The honest part, stated on screen rather than buried: **nothing on the public
 * site reads those query parameters yet.** The links below are what the URLs
 * would be. Printing them as working links would be the defect AGENTS.md names.
 */
export default async function SpecialPurposeAgendaPage() {
  await requireOrganizer();
  const [tracks, sessions] = await Promise.all([listTracks(), listSessions()]);

  const published = sessions.filter((s) => s.status === 'published');
  const days = [...new Set(published.map((s) => s.day))].sort();

  const slices = [
    ...days.map((d) => ({
      kind: 'Day',
      label: d,
      param: `?day=${d}`,
      count: published.filter((s) => s.day === d).length,
    })),
    ...tracks.map((t) => ({
      kind: 'Track',
      label: t.name,
      param: `?track=${t.id}`,
      count: t.publishedCount,
    })),
  ];

  return (
    <>
      <PageHeader
        title="Special-Purpose Agenda"
        tags={<Tag color="orange" fill="outline">a filter, not a page</Tag>}
        actions={
          <a href={publicUrl('/agenda')} target="_blank" rel="noreferrer" className="whova-btn-main">
            View the live agenda ↗
          </a>
        }
        links={[
          <Link key="g" href="/marketing/event-webpages/agenda-webpage/general-purpose">
            General-purpose agenda
          </Link>,
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
        ]}
      />

      <Banner kind="info">
        Whova needs a second hosted page for a filtered agenda because their pages take no
        parameters. <strong>Ours would be a query string on the one page we already have.</strong>{' '}
        The slices below are the ones the current programme supports; the URLs are what they would
        be, and nothing on the public site reads them yet.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Published sessions', value: published.length, sub: 'the whole programme' },
          { label: 'Days', value: days.length, sub: 'each a possible slice' },
          { label: 'Tracks', value: tracks.length, sub: 'each a possible slice' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Slices this programme would support</h2>
        <Table
          cols={[
            { key: 'k', label: 'Kind', className: 'cell-sm' },
            { key: 'l', label: 'Slice', className: 'cell-fill' },
            { key: 'u', label: 'URL it would be', className: 'cell-md' },
            { key: 'n', label: 'Sessions', className: 'cell-sm' },
          ]}
          rows={slices.map((s) => [
            <Tag key="k" color={s.kind === 'Day' ? 'blue' : 'purple'} fill="outline" small>
              {s.kind}
            </Tag>,
            s.label,
            <code key="u" style={{ fontSize: 12 }}>
              /agenda{s.param}
            </code>,
            // A slice with nothing in it is worth seeing: it is usually a track
            // whose sessions are all still draft, not a track nobody wanted.
            s.count === 0 ? <span key="n" className="muted">none published</span> : s.count,
          ])}
          empty="No published sessions yet, so there is nothing to slice."
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>The query parameters themselves.</strong> <code>/agenda</code> filters in the
            browser today; it does not read <code>?day=</code> or <code>?track=</code> from the URL.
            Making it do so is an afternoon in <code>apps/web</code>, and until somebody does it
            these links go to the unfiltered page.
          </li>
          <li>
            <strong>A saved, named slice.</strong> Whova lets you build and keep several
            special-purpose pages. A query string is not a saved object, so there is nothing to
            name, nothing to list and nothing to delete.
          </li>
          <li>
            <strong>An embed snippet.</strong> Whova gives you an iframe to paste into a partner
            site. Ours <em>is</em> the site, so there is nothing to embed it into.
          </li>
          <li>
            <strong>Per-slice traffic figures.</strong> Nothing measures visits to the public site
            at all — see Analytics under this same menu for why that is a decision rather than an
            oversight.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
