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
            <strong>There is no marketplace to list in</strong>
            <p>
              The channels below are the ones that work for a conference on its own domain, and none
              of them is a button here, each is a form somebody fills in once. The second table is
              the copy those forms ask for, read from the programme and the catalogue.
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
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What an event listing is actually for</h2>
        <p className="body-2" style={{ marginTop: 0 }}>
          Being findable by people who are <em>not already looking for you</em>. For a conference on
          its own domain that is search, the field&rsquo;s own calendars, and other people&rsquo;s
          newsletters.
        </p>
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
                Structured data on the public pages so a search engine renders KGC as an event with
                dates and a venue rather than a page of text. <code>schema.org/Event</code> JSON-LD
                is on{' '}
                <a href={publicUrl('/')} target="_blank" rel="noreferrer">
                  /
                </a>{' '}
                and{' '}
                <a href={publicUrl('/agenda')} target="_blank" rel="noreferrer">
                  /agenda
                </a>{' '}
                now, generated from the programme and the ticket catalogue rather than typed. The
                dates come from the published sessions, the price range from{' '}
                <code>ticketTypes</code>, so it cannot drift from what the pages say.
              </span>,
              <Tag key="s" color="green" small>
                done
              </Tag>,
            ],
            [
              'Community calendars',
              'The knowledge-graph field has a handful. Mailing lists, a few aggregators, the semantic-web community calendar. Each is a form somebody fills in once. There is no API to integrate with and no screen would help.',
              <Tag key="s" color="grey" small>
                by hand
              </Tag>,
            ],
            [
              'Other people’s newsletters',
              <span key="w">
                The highest-yield channel a research conference has, and it is a relationship rather
                than a feature. Give each one a{' '}
                <Link href="/tickets/ticket-marketing/campaign-link-tracking">tracked link</Link> so
                you learn which ones are worth asking again.
              </span>,
              <Tag key="s" color="green" small>
                measurable
              </Tag>,
            ],
            [
              'Speakers’ own audiences',
              <span key="w">
                Bigger than any directory. Give each speaker a{' '}
                <Link href="/tickets/ticket-marketing/referral-contest">referral link</Link>. Built,
                and the closest thing here to what a listing promises.
              </span>,
              <Tag key="s" color="green" small>
                built
              </Tag>,
            ],
          ]}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What a listing would say, if there were one</h2>
        <p className="body-2" style={{ marginTop: 0 }}>
          Kept here because it is the copy every calendar submission asks for, and having it in one
          place beats retyping it into six forms.
        </p>
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
                  Not inputted yet, no session is published
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
