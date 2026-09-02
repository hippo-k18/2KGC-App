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
 * Ours does. `/agenda` reads `?day=` and `?track=` on the server and renders the
 * slice, so a special-purpose agenda is a query string rather than a second
 * page — which means the useful thing this screen can do is hand an organizer
 * the real URLs, with the size of each slice beside them, so they know what a
 * partner is actually receiving before they send it.
 *
 * ⚠️ **`?track=` carries the track id, not its name**, and that is why the
 * links below are generated rather than typed. A track renamed the week before
 * the event would kill every printed link built on its name, silently, by
 * matching nothing — the public page filters on `SessionDoc.trackIds`, which
 * survives a rename.
 *
 * The one behaviour worth knowing before sending a link: the public page
 * filters on **every** track a session is cross-listed in, not on the coloured
 * chip it displays. A talk in two tracks appears in both slices, which is what
 * the programme chairs meant when they cross-listed it. `listTracks()` counts
 * the same way, so the numbers below are the numbers a partner sees — with one
 * difference to know about: the public page also drops soft-deleted sessions
 * (`deletedAt`) and this count does not, so a track can read one higher here
 * than it renders there.
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
        tags={<Tag color="green" fill="outline">a filter, not a page</Tag>}
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
        parameters. <strong>Ours is a query string on the one page we already have.</strong> The
        slices below are the ones the current programme supports, and every URL is live — open one
        and the public agenda renders that slice, with the filter shown as selected so a visitor
        can widen it.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Published sessions', value: published.length, sub: 'the whole programme' },
          { label: 'Days', value: days.length, sub: 'each a possible slice' },
          { label: 'Tracks', value: tracks.length, sub: 'each a possible slice' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Slices this programme supports</h2>
        <Table
          cols={[
            { key: 'k', label: 'Kind', className: 'cell-sm' },
            { key: 'l', label: 'Slice', className: 'cell-fill' },
            { key: 'u', label: 'URL', className: 'cell-md' },
            { key: 'n', label: 'Sessions', className: 'cell-sm' },
          ]}
          rows={slices.map((s) => [
            <Tag key="k" color={s.kind === 'Day' ? 'blue' : 'purple'} fill="outline" small>
              {s.kind}
            </Tag>,
            s.label,
            <a
              key="u"
              href={publicUrl(`/agenda${s.param}`)}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12 }}
            >
              <code>/agenda{s.param}</code> ↗
            </a>,
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
            <strong>Combining more than the two.</strong> <code>?day=</code> and{' '}
            <code>?track=</code> compose with each other and with nothing else. A slice by format,
            by room or by skill level would be another parameter on the public page; the fields are
            all on <code>SessionDoc</code>, so it is a small change rather than an absent one.
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
