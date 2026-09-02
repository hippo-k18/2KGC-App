import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listContacts, summariseContacts } from '@/lib/campaigns';
import { GapPanel, PER_PAGE, listParams, paginate } from '../../../ui';
import { Banner, PageHeader, Pagination, Panel, SearchInput, StatTiles, Table, Tag } from '../../../ui';
import { toggleSubscribedAction } from './actions';
import { ContactImportForm } from './import-form';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Marketing › Campaign Contact List.
 *
 * ── A contact is not an attendee, and that is the whole design ──────────────
 *
 * Everyone here has bought nothing. Last year's delegates, a partner
 * association's export, the people who filled in "notify me". Whova keeps them
 * apart from registrations for the same reason this does: folding them together
 * would put people holding no ticket into the collection that decides who gets
 * through the door, and would make "how many attendees do we have?"
 * unanswerable.
 *
 * ── The suppression column is the most important thing on this page ─────────
 *
 * ⚠️ A conference that emails people who asked it to stop gets its sending
 * domain blocked, and the damage lands on the *transactional* mail — the
 * receipts and claim codes — not on the newsletter that caused it. So the
 * mailable count is shown beside the total everywhere, an import can never
 * clear an unsubscribe, and every audience this feeds is filtered before it is
 * counted.
 *
 * ── Most unsubscribes will not arrive through this screen ───────────────────
 *
 * The number in the *Unsubscribed* tile is mostly written by readers, not by
 * organizers. Every campaign mail carries a `/u/{token}` link and the RFC 8058
 * headers that let Gmail and Apple Mail unsubscribe on the reader's behalf
 * without opening anything; both land on `contacts.unsubscribedAt` directly.
 * The toggle in the table is for the person who replied to a mail asking to be
 * taken off, and it is also the *only* writer that can clear the field — there
 * is deliberately no public way back on. See the gap notes at the foot of the
 * page.
 */
export default async function CampaignContactListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();

  const sp = await searchParams;
  const { page, baseParams } = listParams(sp);
  const q = typeof sp.q === 'string' ? sp.q : '';
  const list = typeof sp.list === 'string' ? sp.list : '';

  const all = await listContacts();
  const summary = summariseContacts(all);

  const filtered = all
    .filter((c) => (list ? c.lists.includes(list) : true))
    .filter((c) =>
      q
        ? [c.email, c.name, c.company, c.source].some((v) => v.toLowerCase().includes(q.toLowerCase()))
        : true,
    );

  const rows = paginate(filtered, page, PER_PAGE);

  return (
    <>
      <PageHeader
        title="Campaign Contact List"
        tags={
          <Tag color={summary.mailable > 0 ? 'blue' : 'grey'}>
            {summary.mailable} mailable
          </Tag>
        }
        links={[
          <Link key="e" href="/tickets/ticket-marketing/email-campaign">
            Email Campaign
          </Link>,
          <Link key="l" href="/tickets/ticket-marketing/campaign-link-tracking">
            Link Tracking
          </Link>,
          <Link key="a" href="/attendees/manage-attendees/attendees">
            Attendees
          </Link>,
        ]}
      />

      {summary.total === 0 ? (
        <Banner kind="info">
          <strong>No contacts yet.</strong> Import last year&rsquo;s delegate list, a partner
          export, or anyone who asked to be told when tickets open. These are people to email — none
          of them holds a ticket, and importing one here does not create a registration.
        </Banner>
      ) : (
        <Banner kind={summary.unsubscribed + summary.bounced > 0 ? 'warning' : 'info'}>
          <strong>
            {summary.mailable} of {summary.total} may be emailed.
          </strong>{' '}
          {summary.unsubscribed} unsubscribed and {summary.bounced} bounced, and both are excluded
          from every send. ⚠️ An import can never clear a suppression — mailing people who asked you
          to stop is how a sending domain gets blocked, and it takes the ticket receipts down with
          it.
        </Banner>
      )}

      <StatTiles
        tiles={[
          { label: 'Contacts', value: summary.total, sub: `${summary.lists.length} lists` },
          { label: 'Mailable', value: summary.mailable, sub: 'after suppression' },
          { label: 'Unsubscribed', value: summary.unsubscribed, sub: 'never re-added by an import' },
          { label: 'Bounced', value: summary.bounced, sub: 'dead mailbox' },
        ]}
      />

      {summary.lists.length > 0 && (
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Lists</h2>
          <Table
            cols={[
              { key: 'n', label: 'List', className: 'cell-fill' },
              { key: 'c', label: 'Contacts', className: 'cell-sm' },
              { key: 'm', label: 'Mailable', className: 'cell-sm' },
              { key: 'a', label: '', className: 'cell-sm' },
            ]}
            rows={summary.lists.map((l) => [
              l.name,
              l.count,
              <span key="m" className={l.mailable < l.count ? 'muted' : undefined}>
                {l.mailable}
                {l.mailable < l.count ? ` (${l.count - l.mailable} suppressed)` : ''}
              </span>,
              <Link key="a" href={`?list=${encodeURIComponent(l.name)}`}>
                Show
              </Link>,
            ])}
          />
        </Panel>
      )}

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>
          Contacts
          {list ? (
            <>
              {' '}
              <span className="muted" style={{ fontWeight: 400 }}>
                on {list}
              </span>{' '}
              <Link href="?" style={{ fontSize: 12, fontWeight: 400 }}>
                show all
              </Link>
            </>
          ) : null}
        </h2>

        {/*
          A GET form, so the search term lands in the query string and the page
          is linkable and back-button-able. `list` rides along as a hidden field
          — without it, searching inside a list silently drops the list.
        */}
        <form method="get" style={{ marginBottom: 12 }}>
          {list ? <input type="hidden" name="list" value={list} /> : null}
          <SearchInput defaultValue={q} placeholder="Search by address, name or company" />
        </form>

        <Table
          cols={[
            { key: 'e', label: 'Contact', className: 'cell-fill' },
            { key: 'c', label: 'Company', className: 'cell-md' },
            { key: 'l', label: 'Lists', className: 'cell-md' },
            { key: 's', label: 'Status', className: 'cell-sm' },
            { key: 'a', label: '', className: 'cell-sm' },
          ]}
          rows={rows.map((c) => [
            <div key="e">
              <div>{c.email}</div>
              {c.name ? (
                <div className="muted" style={{ fontSize: 11 }}>
                  {c.name}
                  {c.source ? ` · via ${c.source}` : ''}
                </div>
              ) : null}
            </div>,

            <span key="c" style={{ fontSize: 12 }}>
              {c.company || <span className="muted">—</span>}
            </span>,

            <span key="l" style={{ fontSize: 12 }}>
              {c.lists.join(', ') || <span className="muted">none</span>}
            </span>,

            c.bouncedAt ? (
              <Tag key="s" color="red" small>
                bounced
              </Tag>
            ) : c.unsubscribedAt ? (
              <Tag key="s" color="grey" small>
                unsubscribed
              </Tag>
            ) : c.converted ? (
              <Tag key="s" color="green" small>
                bought
              </Tag>
            ) : (
              <Tag key="s" color="blue" small>
                mailable
              </Tag>
            ),

            /*
              A form, not a link. A GET that unsubscribes somebody is one link
              prefetch away from removing a contact nobody touched — and the same
              shape on the public side is how a mail client's link scanner
              unsubscribes a whole list.
            */
            c.bouncedAt ? (
              <span key="a" className="muted" style={{ fontSize: 12 }}>
                —
              </span>
            ) : (
              <form key="a" action={toggleSubscribedAction}>
                <input type="hidden" name="contactId" value={c.id} />
                <input type="hidden" name="subscribed" value={c.unsubscribedAt ? '1' : '0'} />
                <button type="submit" className="linkish">
                  {c.unsubscribedAt ? 'Re-subscribe' : 'Unsubscribe'}
                </button>
              </form>
            ),
          ])}
          empty={
            all.length === 0
              ? 'Nothing imported yet — use the form below.'
              : 'Nothing matches that search.'
          }
        />

        <Pagination
          total={filtered.length}
          page={page}
          perPage={PER_PAGE}
          baseParams={baseParams}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Import a list</h2>
        <ContactImportForm existingLists={summary.lists.map((l) => l.name)} />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Bounces are not detected automatically.</strong> The field exists and nothing
            writes it — that needs a Resend webhook, which is a route in{' '}
            <code>apps/web</code> and a day&rsquo;s work. Until then a hard bounce is recorded by
            hand or not at all.
          </li>
          <li>
            <strong>Re-subscribing is only possible here, on purpose.</strong> The public
            unsubscribe page has no way back on and says so, because a link that could re-subscribe
            somebody is a link a third party could use to do it — and{' '}
            <code>unsubscribedAt</code> is the single field the whole suppression story rests on.
            The <em>Re-subscribe</em> button in the table above is the only writer that clears it,
            and it exists so that a person who wrote in and asked can be put back by a human who
            read the request. Somebody who lands on the unsubscribe page by mistake is told to email
            us; that is slower than a second click, and slower is the correct trade here.
          </li>
          <li>
            <strong>&ldquo;Bought&rdquo; is not computed.</strong> The <code>converted</code> flag
            is on the model and nothing sets it; matching contacts against registrations by address
            is a read of both collections and is the obvious next piece.
          </li>
          <li>
            <strong>No export.</strong> The six CSV exports elsewhere in this dashboard go through
            one registry, so a seventh is an entry rather than a module.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
