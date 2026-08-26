import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes } from '@/lib/commerce';
import { pageReadiness, publicUrl } from '@/lib/webpages';
import { Banner, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Marketing › Event Website.
 *
 * ── This is the one tab where we are ahead of Whova ─────────────────────────
 *
 * Whova hosts a generated event website on a `whova.com` URL and gives you an
 * embed snippet for your real one. KGC has a real one: `apps/web` serves the
 * marketing pages, the agenda, the speaker list and the checkout from a single
 * deployment on the conference's own domain, reading the same Firestore the
 * app reads. There is nothing to generate and nowhere to embed it.
 *
 * So this screen is not a site builder. It answers the question a site builder
 * exists to answer — <em>is the public site ready for the campaign you are
 * about to send</em> — and that is computable from the data.
 *
 * ── Readiness, not settings ─────────────────────────────────────────────────
 *
 * The useful question about a public page is not what colour it is but whether
 * it is embarrassing yet: a speaker grid with eleven missing headshots, an
 * agenda with four sessions in no room, a ticket page with nothing on sale.
 * Driving a campaign at a page in that state is how a conference spends its
 * best send on its worst impression.
 */
export default async function EventWebsitePage() {
  await requireOrganizer();

  const [readiness, tickets] = await Promise.all([pageReadiness(), listTicketTypes()]);

  const pages = [readiness.agenda, readiness.speakers, readiness.sponsors];
  const problems = pages.reduce((n, p) => n + p.problems.reduce((m, x) => m + x.count, 0), 0);

  const sellable = (audience: string) =>
    tickets.filter((t) => t.audience === audience && t.visible).length;

  const ticketPages = [
    { path: '/tickets', label: 'Attendee tickets', listed: sellable('attendee') },
    { path: '/tickets/exhibitor', label: 'Exhibitor packages', listed: sellable('exhibitor') },
    { path: '/tickets/sponsor', label: 'Sponsorship', listed: sellable('sponsor') },
  ];

  return (
    <>
      <PageHeader
        title="Event Website"
        tags={
          problems === 0 ? (
            <Tag color="green" fill="outline">
              ready
            </Tag>
          ) : (
            <Tag color="orange">{problems} to fix</Tag>
          )
        }
        links={[
          <a key="v" href={publicUrl('/')} target="_blank" rel="noreferrer">
            Open the site ↗
          </a>,
          <Link key="w" href="/marketing/event-webpages/agenda-webpage/general-purpose">
            Event Webpages
          </Link>,
          <Link key="p" href="/publish">
            Publish
          </Link>,
        ]}
      />

      <Banner kind={problems === 0 ? 'info' : 'warning'}>
        {problems === 0 ? (
          <>
            <strong>Nothing on the public pages looks unfinished.</strong> Every published session
            has a room, a speaker and a description; every speaker has a photo and a bio; every
            sponsor has a logo. Send the campaign.
          </>
        ) : (
          <>
            <strong>{problems} things would look unfinished to a visitor today.</strong> They are
            listed below, worst first. Driving a campaign at a page in this state spends your best
            send on your worst impression — these are cheap to fix and expensive to skip.
          </>
        )}
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Sessions published', value: readiness.agenda.published, sub: `of ${readiness.agenda.total}` },
          { label: 'Speakers listed', value: readiness.speakers.published, sub: 'on /speakers' },
          { label: 'Sponsors listed', value: readiness.sponsors.published, sub: 'on /sponsor' },
          { label: 'Issues', value: problems, sub: problems ? 'visible to a visitor' : 'none' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Data-driven pages</h2>
        <Table
          cols={[
            { key: 'p', label: 'Page', className: 'cell-md' },
            { key: 'c', label: 'Live', className: 'cell-sm' },
            { key: 'i', label: 'What a visitor would notice', className: 'cell-fill' },
          ]}
          rows={pages.map((p) => [
            <div key="p">
              <a href={publicUrl(p.path)} target="_blank" rel="noreferrer">
                {p.title}
              </a>
              <div className="muted" style={{ fontSize: 11 }}>
                <code>{p.path}</code>
              </div>
            </div>,

            <span key="c">
              {p.published}
              {p.total !== p.published ? (
                <span className="muted"> / {p.total}</span>
              ) : null}
            </span>,

            p.problems.length === 0 ? (
              <Tag key="i" color="green" small>
                nothing
              </Tag>
            ) : (
              <span key="i" style={{ fontSize: 12 }}>
                {p.problems.map((x) => `${x.count} ${x.label}`).join(' · ')}
              </span>
            ),
          ])}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where a campaign can send people</h2>
        <Table
          cols={[
            { key: 'p', label: 'Page', className: 'cell-md' },
            { key: 'l', label: 'On sale', className: 'cell-sm' },
            { key: 's', label: 'State', className: 'cell-fill' },
          ]}
          rows={ticketPages.map((t) => [
            <div key="p">
              <a href={publicUrl(t.path)} target="_blank" rel="noreferrer">
                {t.label}
              </a>
              <div className="muted" style={{ fontSize: 11 }}>
                <code>{t.path}</code>
              </div>
            </div>,
            t.listed,
            t.listed > 0 ? (
              <span key="s">Sells {t.listed} {t.listed === 1 ? 'package' : 'packages'} live from the catalogue.</span>
            ) : (
              <span key="s" className="muted">
                Renders, and has nothing to sell — it tells a visitor this is not open yet. Do not
                point a campaign at it.
              </span>
            ),
          ])}
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          Use a <Link href="/tickets/ticket-marketing/campaign-link-tracking">tracked link</Link>{' '}
          rather than the raw path, or the campaign cannot be measured and therefore cannot be
          repeated.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No content editor.</strong> Every page is a React file, so changing the code of
            conduct is a deploy. That is Phase 5 of <code>ROADMAP.md</code> and it is the real gap
            on this screen — a content-management project rather than a missing button.
          </li>
          <li>
            <strong>No theming.</strong> Colours, logo and banner would need the Storage upload
            pipeline that <code>ROADMAP.md</code> records as blocker 3.
          </li>
          <li>
            <strong>No hosted alternative site.</strong> Whova&rsquo;s value here is for a
            conference whose website is older than its ticketing. KGC&rsquo;s website{' '}
            <em>is</em> its ticketing, so generating a second one would be building a worse copy of
            something that already works.
          </li>
        </ul>
      </Panel>
    </>
  );
}
