import Link from 'next/link';
import type { LinkRow } from '@/lib/campaigns';
import type { SponsorReportRow } from '@/lib/sponsor-report';
import { NotInputted, Panel, StatTiles, Table, Tag } from '../../../ui';

/**
 * One sponsor's report.
 *
 * ── Short, and honest about why ────────────────────────────────────────────
 *
 * Whova's sponsor ROI report counts profile views, document downloads and booth
 * visits. None of those is recorded anywhere in this project: the app opens a
 * sponsor's card and writes nothing, and a sponsor's downloads are links to
 * other people's servers that nothing here sits in front of. So this shows what
 * is counted — tracked links, their clicks, the purchases they led to, and any
 * lead documents — and says the rest is not recorded, in one line, rather than
 * filling the gap with a plausible number.
 *
 * That refusal is the point. "1,240 profile views" is a figure somebody quotes
 * in a renewal conversation, and a made-up one is worse than the gap it hides.
 *
 * ── The link list is there so the match can be checked ─────────────────────
 *
 * A link belongs to a sponsor because somebody typed their name into the owner
 * box on Link Tracking. That is free text and not a key, so the links are named
 * rather than only totalled: an organizer who expected a link and cannot see it
 * here can tell at once that the owner is spelled some other way.
 */
export function SponsorReportView({
  report,
  strays,
}: {
  report: SponsorReportRow;
  /** Tracked links whose owner matches no sponsor at all. */
  strays: LinkRow[];
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>
        {report.name} <Tag color="blue">{report.tier}</Tag>
      </h2>
      <p className="body-2" style={{ marginTop: 0 }}>
        {report.boothLocation ? `Booth ${report.boothLocation}. ` : ''}
        Everything below is counted. Nothing on this page is estimated.
      </p>

      <StatTiles
        tiles={[
          {
            label: 'Link clicks',
            value: report.clicks,
            sub: `across ${report.links.length} ${report.links.length === 1 ? 'link' : 'links'}`,
          },
          {
            label: 'Purchases',
            value: report.orders,
            sub: 'bought after following one',
          },
          {
            label: 'Leads',
            value: report.leads,
            sub: report.leads > 0 ? 'people asked for contact' : 'none recorded',
          },
          {
            label: 'Last click',
            value: report.lastClickAt ? report.lastClickAt.slice(0, 10) : '—',
            sub: report.lastClickAt ? 'most recent of their links' : 'no clicks yet',
          },
        ]}
      />

      <h3 style={{ fontSize: 14 }}>Their tracked links</h3>
      <Table
        stackSm
        cols={[
          { key: 'l', label: 'Link', className: 'cell-fill' },
          { key: 'c', label: 'Clicks', className: 'cell-sm' },
          { key: 'o', label: 'Purchases', className: 'cell-sm' },
          { key: 'd', label: 'Last click', className: 'cell-sm' },
        ]}
        rows={report.links.map((l) => [
          <span key="l">
            <strong>{l.label || l.code}</strong>
            <div className="muted" style={{ fontSize: 11 }}>
              /r/{l.code} → {l.destination}
              {l.active ? '' : ' · retired'}
            </div>
          </span>,
          l.clicks,
          l.orders,
          l.lastClickedAt ? l.lastClickedAt.slice(0, 10) : <span className="muted">—</span>,
        ])}
        empty={
          <NotInputted
            what="tracked links for this sponsor"
            compact
            action={
              <Link
                href="/tickets/ticket-marketing/campaign-link-tracking"
                className="whova-btn-main secondary"
              >
                Make one
              </Link>
            }
          />
        }
      />
      <p className="muted" style={{ fontSize: 12 }}>
        A link counts for this sponsor when its owner is their name.
      </p>

      {strays.length > 0 && (
        <Panel style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 14, marginTop: 0 }}>
            {strays.length} tracked {strays.length === 1 ? 'link belongs' : 'links belong'} to
            somebody who is not a sponsor
          </h3>
          <p className="body-2" style={{ marginTop: 0 }}>
            Usually a speaker referral. If one of these should be on a sponsor report, change its
            owner to the sponsor&rsquo;s name.
          </p>
          <Table
            stackSm
            cols={[
              { key: 'l', label: 'Link', className: 'cell-fill' },
              { key: 'o', label: 'Owner', className: 'cell-md' },
              { key: 'c', label: 'Clicks', className: 'cell-sm' },
            ]}
            rows={strays.map((l) => [l.label || l.code, l.owner, l.clicks])}
          />
        </Panel>
      )}

      <p className="body-2" style={{ marginTop: 16 }}>
        Profile views and document opens are not recorded, so they are not shown.
      </p>

      <div className="toolbar">
        {/*
          A plain anchor with `download`. `/export/sponsor-report` answers with a
          CSV and a `Content-Disposition` header, which `next/link` would try to
          treat as a page. The file covers every sponsor, not only this one: the
          question it answers is "how did the sponsorships do", and a file per
          sponsor is eighteen downloads to join by hand.
        */}
        <a href="/export/sponsor-report" className="btn btn-default" download>
          Export every sponsor to CSV
        </a>
      </div>
    </div>
  );
}
