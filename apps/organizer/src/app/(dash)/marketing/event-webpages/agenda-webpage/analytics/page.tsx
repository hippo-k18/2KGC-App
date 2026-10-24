import Link from 'next/link';
import { publicSiteOrigin } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listLinks } from '@/lib/campaigns';
import { money } from '@/lib/commerce';
import { listSessions } from '@/lib/data';
import { publicUrl } from '@/lib/webpages';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Webpages › Agenda Webpage › Analytics.
 *
 * Whova counts views of its hosted agenda page and draws a line chart.
 *
 * ── What is measurable here, and what is not ────────────────────────────────
 *
 * No page on knowledgegraph.tech is instrumented: no Google Analytics, no
 * Plausible, no first-party beacon. So "how many people looked at the agenda"
 * has no answer, and this screen used to be three paragraphs saying so followed
 * by a table of privacy trade-offs — an argument written for whoever was
 * building the dashboard rather than for the organizer opening it.
 *
 * One kind of traffic *is* real: every link created on Campaign Link Tracking
 * is counted by the `/r/{code}` redirect itself, and fulfilment stamps
 * `campaignCode` onto the order, so a click can be followed to a purchase. None
 * of that waits on a Cloud Function. This screen is therefore the links that
 * point at the agenda, and what they did — which is a smaller claim than
 * Whova's and an entirely true one.
 *
 * The honest boundary, kept in the header's `info` tip: the denominator is
 * "people who clicked a link we made", never "people who came".
 */
export default async function AgendaAnalyticsPage() {
  await requireOrganizer();

  const [links, sessions] = await Promise.all([listLinks(), listSessions()]);
  const origin = publicSiteOrigin();

  /*
   * `/agenda` and every slice of it. A special-purpose agenda is a query string
   * on the same page here rather than a second page, so a link to
   * `/agenda?track=…` is still a link to the agenda and belongs in this total.
   */
  const agendaLinks = links.filter((l) => l.destination.split('?')[0] === '/agenda');

  const clicks = agendaLinks.reduce((n, l) => n + l.clicks, 0);
  const orders = agendaLinks.reduce((n, l) => n + l.orders, 0);
  const revenue = agendaLinks.reduce((n, l) => n + l.revenueCents, 0);
  const currency = agendaLinks.find((l) => l.revenueCents > 0)?.currency ?? 'usd';
  const lastClick = agendaLinks
    .map((l) => l.lastClickedAt)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);

  const published = sessions.filter((s) => s.status === 'published').length;

  return (
    <>
      <PageHeader
        title="Agenda Webpage Analytics"
        info={
          <>
            <strong>Links, not page views</strong>
            <p>
              Only clicks on tracked links are counted. Visitors who reach the agenda any other way
              are not counted.
            </p>
          </>
        }
        tags={
          agendaLinks.length > 0 ? (
            <Tag color="green" fill="outline">
              {agendaLinks.length} tracked {agendaLinks.length === 1 ? 'link' : 'links'}
            </Tag>
          ) : (
            <Tag color="grey" fill="outline">
              nothing tracked yet
            </Tag>
          )
        }
        actions={
          <a href={publicUrl('/agenda')} target="_blank" rel="noreferrer" className="whova-btn-main secondary">
            View the live agenda ↗
          </a>
        }
        links={[
          <Link key="c" href="/tickets/ticket-marketing/campaign-link-tracking">
            Campaign links
          </Link>,
          <Link key="g" href="/marketing/event-webpages/agenda-webpage/general-purpose">
            General-purpose agenda
          </Link>,
          <Link key="s" href="/marketing/event-webpages/agenda-webpage/special-purpose">
            Special-purpose agenda
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          {
            label: 'Clicks to the agenda',
            value: clicks,
            sub: lastClick ? `last ${lastClick.slice(0, 10)}` : 'no clicks yet',
          },
          {
            label: 'Orders credited',
            value: orders,
            sub: clicks > 0 ? `${Math.round((orders / clicks) * 100)}% of clicks` : 'no clicks yet',
          },
          { label: 'Revenue credited', value: money(revenue, currency), sub: 'net of refunds' },
          { label: 'Published sessions', value: published, sub: 'on the public agenda' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Links pointing at the agenda</h2>
        <Table
          cols={[
            { key: 'l', label: 'Link', className: 'cell-fill' },
            { key: 'd', label: 'Goes to', className: 'cell-md' },
            { key: 'c', label: 'Clicks', className: 'cell-sm' },
            { key: 'n', label: 'Orders', className: 'cell-sm' },
            { key: 'r', label: 'Net', className: 'cell-sm' },
          ]}
          rows={agendaLinks.map((l) => [
            <span key="l">
              <a href={`${origin}/r/${l.code}`} target="_blank" rel="noreferrer">
                /r/{l.code}
              </a>
              {!l.active ? (
                <>
                  {' '}
                  <Tag color="grey" small>
                    retired
                  </Tag>
                </>
              ) : null}
              <div className="muted" style={{ fontSize: 11 }}>
                {l.label}
                {l.channel ? ` · ${l.channel}` : ''}
              </div>
            </span>,
            <code key="d" style={{ fontSize: 12 }}>
              {l.destination}
            </code>,
            l.clicks,
            l.orders,
            l.revenueCents > 0 ? money(l.revenueCents, l.currency) : <span className="muted">—</span>,
          ])}
          empty={
            <NotInputted
              what="links pointing at the agenda"
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
        />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
          One person clicking twice counts as two clicks. A purchase within thirty days of a click
          is credited to the last link clicked.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Page views, unique visitors, referrers, time on page.</strong> None of these are
            collected, stored or estimated anywhere in this repo. A server-side count from the
            hosting logs would answer &ldquo;is the agenda being read&rdquo; with no consent banner
            and no processor; a third-party tracker would answer more and cost a cookie on the
            machine of everybody reading the code of conduct.
          </li>
          <li>
            <strong>The chart.</strong> One counter per link, not a time series. A per-day chart
            needs a document per day per link.
          </li>
          <li>
            <strong>In-app engagement.</strong> Saved sessions are real documents and answer a
            different question; putting them on a webpage-traffic screen would make both misleading.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
