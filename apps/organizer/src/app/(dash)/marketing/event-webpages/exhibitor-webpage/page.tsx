import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { exhibitorSummary, listExhibitors } from '@/lib/exhibitors';
import { publicUrl } from '@/lib/webpages';
import { Banner, PageHeader, Panel, ProgressBar, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Webpages › Exhibitor Webpage.
 *
 * ── This is the one page in the set where Whova is ahead of us ──────────────
 *
 * The other webpage screens are readiness reports because the page already
 * exists: change a session and /agenda changes. This one is not. `exhibitors`
 * is a real collection with real records and Exhibitor Manager edits them, but
 * **no page on knowledgegraph.tech renders an exhibitor**, and the app has no
 * exhibitor surface either. The data is in the building and nobody outside can
 * see it.
 *
 * So the content of this screen is that gap, measured: how many exhibitors are
 * confirmed, how many are missing the fields a public page would have to print,
 * and therefore how much of the work is "write the page" versus "chase the
 * exhibitors". On seeded data those are usually the same size, which is the
 * useful thing to know before promising anybody a listing.
 *
 * Deliberately no "Publish" button. There is nothing to publish to.
 */
export default async function ExhibitorWebpagePage() {
  await requireOrganizer();
  const [rows, summary] = await Promise.all([listExhibitors(), exhibitorSummary()]);

  const live = rows.filter((r) => r.status !== 'cancelled');

  // What a public listing would need per exhibitor, in the order a visitor
  // notices it missing: a hole where a logo goes, then a booth they cannot
  // find, then a blurb that says nothing, then a dead link.
  const gaps = [
    { label: 'no logo — leaves a hole in the grid', count: live.filter((r) => !r.logoURL).length },
    { label: 'no booth number — not findable in the hall', count: live.filter((r) => !r.boothNumber).length },
    { label: 'no description — the card would be a name only', count: live.filter((r) => !r.description).length },
    { label: 'no website link — nowhere for a visitor to go next', count: live.filter((r) => !r.website).length },
  ].filter((g) => g.count > 0);

  const ready = live.filter((r) => r.logoURL && r.boothNumber && r.description && r.website).length;
  const pct = live.length === 0 ? 0 : Math.round((ready / live.length) * 100);

  return (
    <>
      <PageHeader
        title="Exhibitor Webpage"
        tags={<Tag color="red" fill="outline">no public page exists</Tag>}
        actions={
          <a href={publicUrl('/sponsor')} target="_blank" rel="noreferrer" className="whova-btn-main">
            Nearest live page: /sponsor ↗
          </a>
        }
        links={[
          <Link key="m" href="/content/exhibitor-center/exhibitor-manager">
            Exhibitor Manager
          </Link>,
          <Link key="w" href="/marketing/event-website">
            Event Website
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>Exhibitors are modelled, edited and invisible.</strong> The{' '}
        <code>exhibitors</code> collection holds {summary.total} records and Exhibitor Manager
        maintains them, but nothing on knowledgegraph.tech and nothing in the app renders one.
        Sponsors have <code>/sponsor</code>; exhibitors have nowhere.
      </Banner>

      <StatTiles
        tiles={[
          {
            label: 'Exhibitors',
            value: live.length,
            sub: summary.cancelled > 0 ? `${summary.cancelled} cancelled, not counted` : 'none cancelled',
          },
          {
            label: 'Confirmed',
            value: summary.confirmed,
            sub: summary.provisional > 0 ? `${summary.provisional} still provisional` : 'all of them',
          },
          {
            label: 'Would render cleanly',
            value: `${ready}/${live.length}`,
            sub: 'all four public fields present',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>If the page existed today, what would be wrong with it?</h2>
        {live.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Nothing — there are no exhibitors yet. Add them in Exhibitor Manager first.
          </p>
        ) : gaps.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Nothing. Every exhibitor has a logo, a booth, a description and a link, so the only
            missing piece is the page itself.
          </p>
        ) : (
          <>
            <ProgressBar pct={pct} />
            <Table
              cols={[
                { key: 'p', label: 'Problem', className: 'cell-fill' },
                { key: 'n', label: 'Exhibitors', className: 'cell-sm' },
                { key: 'a', label: '', className: 'cell-sm' },
              ]}
              rows={gaps.map((g) => [
                g.label,
                g.count,
                <Link key="a" href="/content/exhibitor-center/exhibitor-manager" style={{ fontSize: 12 }}>
                  Fix in Exhibitor Manager
                </Link>,
              ])}
            />
            <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
              Ordered by how obvious each one would be to a visitor, not by how many there are.
            </p>
          </>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The hall as it stands</h2>
        <Table
          cols={[
            { key: 'b', label: 'Booth', className: 'cell-sm' },
            { key: 'n', label: 'Exhibitor', className: 'cell-fill' },
            { key: 's', label: 'Status', className: 'cell-sm' },
            { key: 'p', label: 'Public fields', className: 'cell-md' },
          ]}
          rows={rows.map((r) => {
            const missing = [
              !r.logoURL ? 'logo' : null,
              !r.boothNumber ? 'booth' : null,
              !r.description ? 'description' : null,
              !r.website ? 'link' : null,
            ].filter(Boolean);
            return [
              r.boothNumber || <span key="b" className="muted">—</span>,
              r.name,
              <Tag
                key="s"
                color={r.status === 'confirmed' ? 'green' : r.status === 'cancelled' ? 'red' : 'orange'}
                fill="outline"
                small
              >
                {r.status}
              </Tag>,
              missing.length === 0 ? (
                <span key="p" style={{ fontSize: 12 }}>
                  complete
                </span>
              ) : (
                <span key="p" className="muted" style={{ fontSize: 12 }}>
                  missing {missing.join(', ')}
                </span>
              ),
            ];
          })}
          empty="No exhibitors yet."
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>The public exhibitor page itself.</strong> A route in <code>apps/web</code>
            reading <code>exhibitors</code>, plus a link in the site nav. It is the smallest piece
            of real parity left on the Marketing tab and it is a code change, not a setting.
          </li>
          <li>
            <strong>An exhibitor surface in the app.</strong> The People tab has attendees,
            speakers and sponsors. There is no exhibitor segment, so a visitor standing in the hall
            cannot look one up on their phone.
          </li>
          <li>
            <strong>Per-exhibitor detail pages with downloads and offers.</strong> Sponsors carry
            offers and downloads on their document; <code>ExhibitorDoc</code> does not, and adding
            them before there is a page to show them on would be modelling for nothing.
          </li>
          <li>
            <strong>Exhibitor self-service.</strong> Whova sends each exhibitor a personal link to
            fill in their own listing. That needs the link-token pattern the badge already uses,
            pointed at a public form nobody has written.
          </li>
          <li>
            <strong>An embed snippet.</strong> Whova gives you an iframe for your own site. Ours{' '}
            <em>is</em> the site — the missing thing here is a page, not a way to include one.
          </li>
        </ul>
      </Panel>
    </>
  );
}
