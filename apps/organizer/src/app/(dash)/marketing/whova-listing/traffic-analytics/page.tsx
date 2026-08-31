import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listLinks } from '@/lib/campaigns';
import { money } from '@/lib/commerce';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

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
        tags={<Tag color="grey" fill="outline">partly not applicable</Tag>}
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

      <Banner kind="info">
        <strong>We measure the links we made, and nothing else.</strong> This screen was originally
        about views of a Whova directory listing, and we are not in a directory. What we do have is
        the tracked-link path: <code>/r/&#123;code&#125;</code> counts the click and stamps a cookie,
        and fulfilment writes that code onto the order — so a click can be followed all the way to
        a purchase. Anyone who arrived any other way is not counted, because no page on
        knowledgegraph.tech is instrumented.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Tracked links', value: links.length, sub: `${links.filter((l) => l.active).length} still active` },
          { label: 'Clicks', value: clicks, sub: 'counted by the redirect, not by a tracker' },
          {
            label: 'Attributed orders',
            value: orders,
            sub: clicks > 0 ? `${Math.round((orders / clicks) * 100)}% of clicks` : 'no clicks yet',
          },
          { label: 'Attributed revenue', value: money(revenueCents, currency), sub: 'net of refunds' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where the traffic we can see came from</h2>
        <Table
          cols={[
            { key: 'l', label: 'Link', className: 'cell-fill' },
            { key: 'c', label: 'Channel', className: 'cell-sm' },
            { key: 'k', label: 'Clicks', className: 'cell-xs' },
            { key: 'o', label: 'Orders', className: 'cell-xs' },
            { key: 'r', label: 'Revenue', className: 'cell-sm' },
            { key: 'w', label: 'Last click', className: 'cell-mdsm' },
          ]}
          empty="No tracked link has been created yet — make one on Campaign Link Tracking and this fills in."
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
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The three halves, kept apart</h2>
        <dl className="gap-grid">
          <dt>Listing traffic</dt>
          <dd>
            Not applicable. Reproducing it means running an event directory, which is a marketplace
            business rather than a screen. Same answer as{' '}
            <Link href="/marketing/organizer-co-promo">Organizer Co-Promo</Link>.
          </dd>
          <dt>Tracked-link traffic</dt>
          <dd>
            Real, and above. Counted by the redirect itself rather than by a trigger, so none of it
            waits on a Cloud Function — and attributed to orders through{' '}
            <code>OrderDoc.campaignCode</code>, which fulfilment stamps from the cookie. Attribution
            is last-click within the cookie&rsquo;s life, stated so it can be argued with.
          </dd>
          <dt>Everyone else</dt>
          <dd>
            Genuinely unmeasured. Somebody who searched for the conference, read three pages and
            bought a ticket appears in the order table and nowhere here. Closing that means a page
            tracker, and what each option costs a visitor is laid out under{' '}
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
