import Link from 'next/link';
import { EVENT } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes } from '@/lib/commerce';
import { listSessions } from '@/lib/data';
import { publicUrl } from '@/lib/webpages';
import { GapPanel, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Marketing › Event Listing.
 *
 * ── This one is not unbuilt. It is not applicable, which is different ───────
 *
 * Whova&rsquo;s Event Listing puts your conference in <em>Whova&rsquo;s own
 * marketplace</em> — a directory inside their product where their users browse
 * events. That is the whole feature: discovery inside a platform that has an
 * audience because it hosts thousands of other conferences.
 *
 * There is no marketplace to list in here, and building one is not parity, it
 * is a different product — one whose value comes entirely from the events it
 * does not yet have. <code>ROADMAP.md</code> lists this under &ldquo;what I
 * would cut&rdquo; for exactly that reason.
 *
 * Saying so plainly is the useful thing this screen can do. A gap note claiming
 * &ldquo;4-6 days&rdquo; would be false: no amount of days produces an audience
 * of other people&rsquo;s attendees.
 *
 * ── What replaces it, and it is not nothing ─────────────────────────────────
 *
 * The job an event listing does for an organizer is <em>be findable by people
 * who are not already looking for you</em>. Whova answers that with their
 * directory. The equivalents that work for a conference on its own domain are
 * search, the field&rsquo;s own calendars, and other people&rsquo;s
 * newsletters — and the table below is those, with what each actually needs,
 * because it is more useful than an empty integration screen.
 */
export default async function EventListingPage() {
  await requireOrganizer();

  const [tickets, sessions] = await Promise.all([listTicketTypes(), listSessions()]);
  const onSale = tickets.filter((t) => t.visible && t.audience === 'attendee').length;

  /**
   * The dates a calendar submission asks for, read rather than typed.
   *
   * They used to be a hard-coded string on this page, which is the one thing a
   * screen like this must not have: a submission form filled in from a date
   * nothing checks is how a conference advertises the wrong week. `day` is the
   * denormalised local day key the programme is authored against, so the range
   * is the first and last day anything is actually published on.
   */
  const publishedDays = [
    ...new Set(sessions.filter((s) => s.status === 'published').map((s) => s.day)),
  ].sort();
  const dateRange =
    publishedDays.length === 0
      ? null
      : publishedDays.length === 1
        ? publishedDays[0]
        : `${publishedDays[0]} to ${publishedDays[publishedDays.length - 1]}`;

  return (
    <>
      <PageHeader
        title="Event Listing"
        info={
          <>
            <strong>Event listing is not available yet</strong>
            <p>
              There is no event directory to list in. Use the channels below, and copy the event
              details from the second table into any calendar form.
            </p>
          </>
        }
        tags={<Tag color="grey">Not applicable</Tag>}
        links={[
          <Link key="w" href="/tickets/ticket-marketing/event-website">
            Event Website
          </Link>,
          <Link key="s" href="/tickets/ticket-marketing/social-sharing">
            Social Sharing
          </Link>,
          <Link key="l" href="/tickets/ticket-marketing/campaign-link-tracking">
            Link Tracking
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where people can find the event</h2>
        <Table
          cols={[
            { key: 'c', label: 'Channel', className: 'cell-md' },
            { key: 'w', label: 'What it needs', className: 'cell-fill' },
            { key: 's', label: 'State', className: 'cell-sm' },
          ]}
          rows={[
            [
              'Search',
              <span key="w">
                The{' '}
                <a href={publicUrl('/')} target="_blank" rel="noreferrer">
                  home page
                </a>{' '}
                and the{' '}
                <a href={publicUrl('/agenda')} target="_blank" rel="noreferrer">
                  agenda
                </a>{' '}
                tell search engines the event dates, venue and price range. They update when the
                agenda or tickets change.
              </span>,
              <Tag key="s" color="green" small>
                done
              </Tag>,
            ],
            [
              'Community calendars',
              'Mailing lists, aggregators and the semantic web community calendar. Each is a form you fill in once.',
              <Tag key="s" color="grey" small>
                by hand
              </Tag>,
            ],
            [
              'Other people’s newsletters',
              <span key="w">
                Give each newsletter a{' '}
                <Link href="/tickets/ticket-marketing/campaign-link-tracking">tracked link</Link> to
                see which ones bring orders.
              </span>,
              <Tag key="s" color="green" small>
                measurable
              </Tag>,
            ],
            [
              'Speakers’ own audiences',
              <span key="w">
                Give each speaker a{' '}
                <Link href="/tickets/ticket-marketing/referral-contest">referral link</Link>.
              </span>,
              <Tag key="s" color="green" small>
                measurable
              </Tag>,
            ],
          ]}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Event details for calendar forms</h2>
        <Table
          cols={[
            { key: 'f', label: 'Field', className: 'cell-sm' },
            { key: 'v', label: 'Value', className: 'cell-fill' },
          ]}
          rows={[
            ['Name', EVENT.name],
            [
              'Dates',
              dateRange ?? (
                <span key="v" className="muted">
                  No session is published yet
                </span>
              ),
            ],
            ['Venue', EVENT.venue],
            [
              'Format',
              tickets.some((t) => t.visible && !t.inPerson)
                ? 'In person, with a remote ticket tier'
                : 'In person',
            ],
            [
              'Tickets',
              <span key="v">
                <a href={publicUrl('/tickets')} target="_blank" rel="noreferrer">
                  {publicUrl('/tickets')}
                </a>{' '}
                · {onSale} {onSale === 1 ? 'tier' : 'tiers'} on sale
              </span>,
            ],
            [
              'Agenda',
              <a key="v" href={publicUrl('/agenda')} target="_blank" rel="noreferrer">
                {publicUrl('/agenda')}
              </a>,
            ],
          ]}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No marketplace, and none planned.</strong> See above. This is a decision, not a
            backlog item.
          </li>
          <li>
            <strong>No proof the markup is read.</strong> The{' '}
            <code>schema.org/Event</code> block is on the public pages and is generated from live
            data — but whether Google renders a rich result from it is Google&rsquo;s decision, and
            nothing here measures it. That needs Search Console, which is an account somebody has
            to own rather than a screen. ⚠️ The block is also omitted entirely while no session is
            published: <code>startDate</code> is required and the only alternative would be parsing
            a date out of marketing copy, which is how a site advertises the wrong week.
          </li>
          <li>
            <strong>No speakers in the markup.</strong> An event&rsquo;s <code>performer</code> list
            is the other thing a rich result shows. It is deliberately absent while{' '}
            <code>SPEAKERS_PAGE_SOURCE</code> in the public site is{' '}
            <code>&lsquo;2026-roster&rsquo;</code> — the <code>speakers</code> collection currently
            holds names the seed invented, and publishing fabricated people in a format built to be
            believed by machines is worse than publishing none. Individual sessions do carry their
            speakers, because those names are already on the page.
          </li>
          <li>
            <strong>No submission tracking.</strong> Which calendars have been written to, and
            when. That is a checklist, and there is one —{' '}
            <Link href="/content/project-management/projects-and-checklists">Projects &amp; Checklists</Link> — rather
            than a second half-built one here.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
