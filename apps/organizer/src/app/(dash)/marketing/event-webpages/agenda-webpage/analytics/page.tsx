import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { publicUrl } from '@/lib/webpages';
import { Banner, GapPanel, PageHeader, Panel, Table, Tag } from '../../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Webpages › Agenda Webpage › Analytics.
 *
 * Whova counts views of the hosted agenda page and shows you a line chart.
 *
 * ── Why this screen has no numbers on it ────────────────────────────────────
 *
 * There is no analytics anywhere in `apps/web`. No Google Analytics, no Plausible,
 * no first-party beacon, no server-side log aggregation. So the honest answer to
 * "how many people looked at the agenda" is **nobody knows**, and the only thing
 * this screen can usefully do is say that once, clearly, and lay out what each
 * way of fixing it would actually cost — because the cost is not engineering
 * time, it is a privacy position taken on behalf of every visitor.
 *
 * A zero here would be a lie of a particular kind: it looks like a measurement.
 * That is why nothing on this page is presented as a figure.
 */

/**
 * The three real options, with the part that decides between them.
 *
 * Ordered by how much of the visitor they take, not by how easy they are.
 */
const OPTIONS = [
  {
    option: 'Nothing (today)',
    gets: 'No idea how many people visit any public page.',
    costs: 'Nothing to build, nothing to disclose, nothing to consent to.',
    tone: 'green' as const,
  },
  {
    option: 'Server-side counts',
    gets: 'Requests per path per day, from the hosting logs. No visitor identity, no cross-page journey.',
    costs:
      'A log pipeline plus somewhere to keep the aggregate. Legitimate interest under GDPR without a banner, because nothing is stored against a person.',
    tone: 'blue' as const,
  },
  {
    option: 'A third-party tracker',
    gets: 'Sessions, sources, funnels — everything an organizer asks for when they ask this question.',
    costs:
      'A processor handling visitor data, a consent banner, a privacy-policy change, and a cookie on the machine of everyone reading the code of conduct.',
    tone: 'orange' as const,
  },
];

export default async function AgendaAnalyticsPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Agenda Webpage Analytics"
        tags={<Tag color="grey" fill="outline">nothing is measured</Tag>}
        actions={
          <a href={publicUrl('/agenda')} target="_blank" rel="noreferrer" className="whova-btn-main">
            View the live agenda ↗
          </a>
        }
        links={[
          <Link key="g" href="/marketing/event-webpages/agenda-webpage/general-purpose">
            General-purpose agenda
          </Link>,
          <Link key="w" href="/marketing/event-website">
            Event Website
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>Nothing on knowledgegraph.tech measures traffic.</strong> Not the agenda page, not
        any of the other eighteen. This screen shows no numbers because there are none — a zero
        here would read as a measurement, and it would not be one.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What measuring it would mean</h2>
        <p className="body-2">
          This is a decision about visitors, not a missing feature. The three options differ mostly
          in how much of a stranger&rsquo;s browsing they take in exchange for the answer.
        </p>
        <Table
          cols={[
            { key: 'o', label: 'Option', className: 'cell-md' },
            { key: 'g', label: 'What you learn', className: 'cell-fill' },
            { key: 'c', label: 'What it costs', className: 'cell-fill' },
          ]}
          rows={OPTIONS.map((o) => [
            <Tag key="o" color={o.tone} fill="outline" small>
              {o.option}
            </Tag>,
            o.gets,
            o.costs,
          ])}
        />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
          The middle row is the one worth arguing about: it answers &ldquo;is the agenda page being
          read&rdquo; without a banner, and it cannot answer &ldquo;did that LinkedIn post work&rdquo;.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Page views, unique visitors, referrers, time on page.</strong> None of these are
            collected, stored or estimated anywhere in this repo.
          </li>
          <li>
            <strong>The chart.</strong> Whova draws views per day. Drawing one from no data would
            mean inventing it.
          </li>
          <li>
            <strong>Conversion from agenda to ticket.</strong> Ticket sales are real and countable
            in Tickets &rsaquo; Orders, but nothing joins a purchase to the page the buyer arrived
            from — that join is precisely what a tracker is for.
          </li>
          <li>
            <strong>In-app engagement is a different question</strong> and partly answerable today:
            saved sessions are real documents. That belongs on an agenda screen, not on a webpage
            traffic screen, and conflating the two would make both misleading.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
