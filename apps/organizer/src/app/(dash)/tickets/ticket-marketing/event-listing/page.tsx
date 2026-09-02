import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes } from '@/lib/commerce';
import { publicUrl } from '@/lib/webpages';
import { Banner, GapPanel, PageHeader, Panel, Table, Tag } from '../../../ui';

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

  const tickets = await listTicketTypes();
  const onSale = tickets.filter((t) => t.visible && t.audience === 'attendee').length;

  return (
    <>
      <PageHeader
        title="Event Listing"
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

      <Banner kind="info">
        <strong>There is nothing to list in, and that is not a gap.</strong> Whova&rsquo;s Event
        Listing advertises your conference inside Whova&rsquo;s own marketplace, whose value comes
        from the thousands of other events it hosts. Reproducing it would mean building a
        marketplace — a different product, and an empty one. It is on{' '}
        <code>ROADMAP.md</code>&rsquo;s cut list beside Organizer Co-Promo for the same reason.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What an event listing is actually for</h2>
        <p className="body-2" style={{ marginTop: 0 }}>
          Being findable by people who are <em>not already looking for you</em>. For a conference on
          its own domain that is search, the field&rsquo;s own calendars, and other people&rsquo;s
          newsletters. None of them is a button in this dashboard, and pretending otherwise would be
          worse than saying so.
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
                now, generated from the programme and the ticket catalogue rather than typed — the
                dates come from the published sessions, the price range from{' '}
                <code>ticketTypes</code>, so it cannot drift from what the pages say.
              </span>,
              <Tag key="s" color="green" small>
                done
              </Tag>,
            ],
            [
              'Community calendars',
              'The knowledge-graph field has a handful — mailing lists, a few aggregators, the semantic-web community calendar. Each is a form somebody fills in once. There is no API to integrate with and no screen would help.',
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
                <Link href="/tickets/ticket-marketing/referral-contest">referral link</Link> — built,
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
            ['Name', 'Knowledge Graph Conference 2027'],
            ['Dates', '3–7 May 2027'],
            ['Venue', 'Cornell Tech, Roosevelt Island, New York City'],
            ['Format', 'In person, with a virtual ticket tier'],
            [
              'Tickets',
              <span key="v">
                <a href={publicUrl('/tickets')} target="_blank" rel="noreferrer">
                  {publicUrl('/tickets')}
                </a>{' '}
                — {onSale} {onSale === 1 ? 'tier' : 'tiers'} on sale
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
