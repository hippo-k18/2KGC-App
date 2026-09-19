import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listLinks } from '@/lib/campaigns';
import { money } from '@/lib/commerce';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Whova Listing › Traffic Analytics.
 *
 * ── Three reasons this screen is thin, and they are different reasons ───────
 *
 * First: it measures traffic to a **Whova listing page**, which does not exist
 * for us, so that half has no subject at all. It is not applicable in the same
 * way My Event Listing is — the object being measured belongs to a directory we
 * are not in.
 *
 * Second: no page on knowledgegraph.tech is instrumented. No Google Analytics,
 * no Plausible, no first-party beacon. That is a privacy decision rather than
 * an oversight, and it is a decision that could be revisited.
 *
 * Third — and this is the part the screen used to get wrong — **one kind of
 * traffic is measured, and it is the kind that matters most.** Every tracked
 * link created on Campaign Link Tracking is counted by the `/r/{code}` redirect
 * itself, and `OrderDoc.campaignCode` is stamped at fulfilment from the cookie
 * that redirect sets. So clicks *and* the purchases they led to are both real
 * records in Firestore. This screen used to say "nothing measuring" and list
 * source-to-ticket attribution as unbuilt; both were false, and the table below
 * is the correction.
 *
 * The distinction still worth keeping is what that data does and does not
 * cover: it measures the links **we** made. Somebody who found the conference
 * through a search engine and typed the address is invisible here, and no
 * amount of link tracking will make them visible — that is what a page tracker
 * would be for, and that is the decision still untaken.
 */
export default async function WhovaListingTrafficPage() {
  await requireOrganizer();

  const links = await listLinks();
  const clicks = links.reduce((n, l) => n + l.clicks, 0);
  const orders = links.reduce((n, l) => n + l.orders, 0);
  const revenueCents = links.reduce((n, l) => n + l.revenueCents, 0);
  const currency = links.find((l) => l.revenueCents > 0)?.currency ?? 'usd';

  return (
    <>
      <PageHeader
        title="Listing Traffic Analytics"
        info={
          <>
            <strong>Tracked links only</strong>
            <p>
              Clicks and purchases are counted for tracked links. Visitors who arrive any other way
              are not counted.
            </p>
          </>
        }
        tags={
          links.length > 0 ? (
            <Tag color="green" fill="outline">
              {links.length} tracked {links.length === 1 ? 'link' : 'links'}
            </Tag>
          ) : (
            <Tag color="grey" fill="outline">
              nothing tracked yet
            </Tag>
          )
        }
        actions={
          <Link href="/tickets/ticket-marketing/campaign-link-tracking" className="whova-btn-main secondary">
            Create a tracked link
          </Link>
        }
        links={[
          <Link key="l" href="/marketing/whova-listing/my-event-listing">
            My event listing
          </Link>,
          <Link key="c" href="/tickets/ticket-marketing/campaign-link-tracking">
            Campaign links
          </Link>,
          <Link key="a" href="/marketing/event-webpages/agenda-webpage/analytics">
            Agenda webpage analytics
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Tracked links', value: links.length, sub: `${links.filter((l) => l.active).length} still active` },
          { label: 'Clicks', value: clicks, sub: 'on tracked links' },
          {
            label: 'Attributed orders',
            value: orders,
            sub: clicks > 0 ? `${Math.round((orders / clicks) * 100)}% of clicks` : 'no clicks yet',
          },
          { label: 'Attributed revenue', value: money(revenueCents, currency), sub: 'net of refunds' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Traffic by link</h2>
        <Table
          cols={[
            { key: 'l', label: 'Link', className: 'cell-fill' },
            { key: 'c', label: 'Channel', className: 'cell-sm' },
            { key: 'k', label: 'Clicks', className: 'cell-xs' },
            { key: 'o', label: 'Orders', className: 'cell-xs' },
            { key: 'r', label: 'Revenue', className: 'cell-sm' },
            { key: 'w', label: 'Last click', className: 'cell-mdsm' },
          ]}
          empty={
            <NotInputted
              what="tracked links"
              compact
              action={
                <Link
                  className="btn btn-primary"
                  href="/tickets/ticket-marketing/campaign-link-tracking"
                >
                  Create one
                </Link>
              }
            />
          }
          rows={links.map((l) => [
            <span key="l">
              <strong>{l.label || l.code}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                /r/{l.code} → {l.destination}
              </div>
            </span>,
            l.channel || <span className="muted">—</span>,
            l.clicks,
            l.orders,
            l.revenueCents > 0 ? money(l.revenueCents, l.currency) : <span className="muted">—</span>,
            <span key="w" style={{ whiteSpace: 'nowrap' }}>
              {l.lastClickedAt ? l.lastClickedAt.slice(0, 16).replace('T', ' ') : <span className="muted">never</span>}
            </span>,
          ])}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What these numbers cover</h2>
        <dl className="gap-grid">
          <dt>Counted</dt>
          <dd>
            Every click on a link above, and every purchase within thirty days of one. The last
            link clicked gets the credit.
          </dd>
          <dt>Not counted</dt>
          <dd>
            Anyone who reached the site without a tracked link. Their orders still show in the
            order table. See{' '}
            <Link href="/marketing/event-webpages/agenda-webpage/analytics">
              Agenda Webpage &rsaquo; Analytics
            </Link>
            .
          </dd>
        </dl>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Listing views, saves and clicks.</strong> No listing exists, so these have no
            subject.
          </li>
          <li>
            <strong>Untracked traffic to knowledgegraph.tech.</strong> Unmeasured by choice. Adding
            a tracker is a privacy position, not a feature request — and until one exists, the
            denominator under every percentage on this page is &ldquo;people who clicked a link we
            made&rdquo;, not &ldquo;people who came&rdquo;.
          </li>
          <li>
            <strong>Unique visitors and a time series.</strong> A tracked link carries one counter,
            not a history, so there is no per-day chart and a person who clicks twice is two clicks.
          </li>
          <li>
            <strong>Referrers.</strong> The redirect records that a link was used, not what page the
            browser came from. That is a header it could read and deliberately does not.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
