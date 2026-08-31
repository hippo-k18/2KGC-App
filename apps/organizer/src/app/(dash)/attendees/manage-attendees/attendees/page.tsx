import Link from 'next/link';
import { COLLECTIONS } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { countWhereEvent, listAttendees } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { GapPanel, PER_PAGE, PageHeader, Pagination, Panel, SearchInput, Table, Tag, listParams, paginate, sortRows } from '../../../ui';
import { Dropdown, RowActions } from '../../../menu';
import { AddAttendeeForm } from './add-form';
import { ImportForm } from './import-form';

export const dynamic = 'force-dynamic';

/**
 * Attendees > Manage Attendees > Attendees.
 *
 * Whova's columns, in Whova's order: avatar, Name, Title, Company, Category,
 * Audience, "Signed into the event", actions. `Audience` is their in-person /
 * remote split; KGC 2027 is in-person only, so every row reads `In Person` and
 * the column is kept because removing it is a decision an organizer should make
 * rather than find already made.
 *
 * The stats block above the table is Whova's too — attendee limit, total, and
 * the sign-in count — and it is the single most-watched number on this screen
 * in the fortnight before doors open, which is why it sits above the fold
 * rather than in an analytics tab.
 *
 * Search filters the whole list in memory, deliberately. At these volumes an
 * in-memory pass beats any query, needs no search service, and cannot fail with
 * `failed-precondition` because it declares no index. The single
 * `where('eventId', '==', …)` behind it is served by Firestore's automatic
 * single-field index.
 */
export default async function AttendeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();

  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const role = typeof sp.role === 'string' ? sp.role : undefined;
  const { page, sort, baseParams } = listParams(sp);
  const importing = typeof sp.import === 'string';
  const adding = typeof sp.add === 'string';
  const [all, registrations] = await Promise.all([
    listAttendees(),
    countWhereEvent(COLLECTIONS.registrations),
  ]);

  const needle = (q ?? '').trim().toLowerCase();
  const matched = all.filter((a) => {
    if (role && !a.roles.includes(role)) return false;
    if (!needle) return true;
    return [a.name, a.email, a.title, a.company, a.ticketType, ...a.interests]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });

  const rows = sortRows(matched, sort.by, sort.dir, {
    name: (a) => a.name,
    title: (a) => a.title ?? '',
    company: (a) => a.company ?? '',
    category: (a) => a.roles.join(', '),
    ticket: (a) => a.ticketType ?? '',
    signedin: (a) => (a.signedIn ? 1 : 0),
    directory: (a) => (a.visibleInDirectory ? 1 : 0),
  });
  const pageRows = paginate(rows, page, PER_PAGE);

  const roles = [...new Set(all.flatMap((a) => a.roles))].sort();
  // The ticket types already in use, rather than the sales catalogue: the point
  // of the select is that a hand-added attendee lands in the same bucket as the
  // people who bought, and "Main Conference " with a trailing space is two
  // buckets in every breakdown with nothing anywhere to flag it.
  const ticketTypes = [...new Set(all.map((a) => a.ticketType).filter(Boolean) as string[])].sort();
  const hidden = all.filter((a) => a.signedIn && !a.visibleInDirectory).length;
  const signedIn = all.filter((a) => a.signedIn).length;
  const ticketHolders = all.filter((a) => a.registrationId).length;
  const href = (next: { q?: string; role?: string }) => {
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.role) p.set('role', next.role);
    const s = p.toString();
    return s ? `?${s}` : ROUTES.attendees;
  };

  return (
    <>
      <PageHeader
        title="Attendees"
        links={[
          <Link key="ma" href="/attendees/manage-attendees">
            Manage Attendees
          </Link>,
          <Link key="ci" href={ROUTES.checkIn}>
            Check-in
          </Link>,
        ]}
      />

      <Panel>
        <div
          style={{
            background: 'var(--surface-alt)',
            border: '1px solid var(--hairline)',
            borderRadius: 4,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 32,
            marginBottom: 16,
            padding: '14px 18px',
          }}
        >
          <div className="body-2">
            <div>
              Total number of attendees: <strong>{all.length}</strong>
            </div>
            <div>
              Holding a ticket: <strong>{ticketHolders}</strong> of {registrations} registrations
            </div>
            {/*
              The number an organizer actually watches in the fortnight before
              doors open, and the reason this screen had to stop reading `users`
              alone: it used to be the *only* number, so a ticket holder who had
              not signed in did not appear at all.
            */}
            <div>
              Signed into the app: <strong>{signedIn}</strong>
              {all.length > 0 && (
                <span className="muted">
                  {' '}
                  ({Math.round((signedIn / all.length) * 100)}%) — {all.length - signedIn} have not
                </span>
              )}
            </div>
          </div>
          <div className="body-2">
            <div style={{ fontWeight: 500 }}>Audience</div>
            <div>● in-person: {all.length} (100.0%)</div>
            <div className="muted">● remote: 0 (0%)</div>
          </div>
        </div>

        <div className="toolbar">
          {/*
            `Add an attendee` was disabled on the argument that adding one by
            hand means writing a document the attendee also owns. That is true
            of `users` — the profile they create at sign-in — and not of a
            registration, which no attendee may write and which the webhook, the
            invoice path and the importer all already create through one shared
            function. So it is the same operation as importing a one-row CSV,
            and now it is that: same `ensureRegistration`, one form.
          */}
          <Link className="btn btn-primary" href={importing ? ROUTES.attendees : '?import=1'}>
            {importing ? 'Cancel import' : 'Import attendees'}
          </Link>
          <Link className="btn btn-primary" href={adding ? ROUTES.attendees : '?add=1'}>
            {adding ? 'Cancel' : 'Add an attendee'}
          </Link>
          <Dropdown
            label="Export attendees"
            className="btn btn-primary"
            items={[
              { label: 'Export basic attendee list', href: '/export/attendees' },
              { label: 'Export badge and catering list', href: '/export/catering' },
              { label: 'Export attendee analytics', href: ROUTES.analyticsExports },
            ]}
          />
          <Link className="btn btn-primary" href={ROUTES.announcements}>
            Send announcement
          </Link>
        </div>

        {importing && (
          <div
            style={{
              background: 'var(--surface-alt)',
              border: '1px solid var(--hairline)',
              borderRadius: 4,
              marginBottom: 16,
              padding: 16,
            }}
          >
            <h2 style={{ fontSize: 15, marginTop: 0 }}>Import attendees</h2>
            <ImportForm />
          </div>
        )}

        {adding && (
          <div
            style={{
              background: 'var(--surface-alt)',
              border: '1px solid var(--hairline)',
              borderRadius: 4,
              marginBottom: 16,
              padding: 16,
            }}
          >
            <h2 style={{ fontSize: 15, marginTop: 0 }}>Add an attendee</h2>
            <AddAttendeeForm ticketTypes={ticketTypes} />
          </div>
        )}

        <form method="get" className="toolbar">
          {role ? <input type="hidden" name="role" value={role} /> : null}
          <SearchInput
            defaultValue={q}
            width={460}
            placeholder="Enter name, email, company, titles, location or category"
          />
          <button type="submit" className="btn btn-default">
            Search
          </button>
          {q ? (
            <Link className="btn btn-default" href={href({ role })}>
              Clear
            </Link>
          ) : null}
        </form>

        <div className="toolbar">
          <Link
            className={`whova-tag-main ${!role ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
            href={href({ q })}
            style={{ textDecoration: 'none' }}
          >
            All Attendees ({all.length})
          </Link>
          {roles.map((r) => (
            <Link
              key={r}
              className={`whova-tag-main ${r === role ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
              href={href({ q, role: r })}
              style={{ textDecoration: 'none' }}
            >
              {r} ({all.filter((a) => a.roles.includes(r)).length})
            </Link>
          ))}
        </div>

        <Table
          cols={[
            { key: 'n', label: 'Name', className: 'cell-mdsm', sortKey: 'name' },
            { key: 't', label: 'Title', className: 'cell-fill', sortKey: 'title' },
            { key: 'c', label: 'Company', className: 'cell-mdsm cell-truncate', sortKey: 'company' },
            { key: 'tk', label: 'Ticket', className: 'cell-sm', sortKey: 'ticket' },
            { key: 'cat', label: 'Category', className: 'cell-sm', sortKey: 'category' },
            { key: 'app', label: 'App', className: 'cell-xs', sortKey: 'signedin' },
            { key: 's', label: 'Directory', className: 'cell-xs', sortKey: 'directory' },
            { key: 'act', label: '', className: 'cell-xs cell-end-align' },
          ]}
          sort={sort}
          empty="No attendee matches that search"
          rows={pageRows.map((a) => [
            <span key="n">
              <strong>{a.name}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {a.email}
              </div>
            </span>,
            a.title ?? <span className="muted">—</span>,
            a.company ?? <span className="muted">—</span>,
            a.ticketType ? (
              <span key="tk">
                {a.ticketType}
                {a.registrationStatus === 'cancelled' && (
                  <div>
                    <Tag color="red" small>
                      refunded
                    </Tag>
                  </div>
                )}
              </span>
            ) : (
              // No registration at all: staff, or a seeded account. Said plainly
              // rather than shown as a blank, which reads as missing data.
              <span key="tk" className="muted">
                no ticket
              </span>
            ),
            a.roles.join(', ') || <span className="muted">—</span>,
            a.signedIn ? (
              <Tag key="app" color="green" fill="outline" small>
                yes
              </Tag>
            ) : (
              <Tag key="app" color="grey" fill="outline" small>
                not yet
              </Tag>
            ),
            a.signedIn ? (
              a.visibleInDirectory ? (
                'Yes'
              ) : (
                <Tag key="d" color="red">
                  opted out
                </Tag>
              )
            ) : (
              <span key="d" className="muted">
                —
              </span>
            ),
            /*
              "Edit attendee" and "Remove from event" were greyed-out menu items
              with no action behind them. Both are removed rather than left
              looking available — the reasons are in the gap panel below, and a
              disabled item in an open menu reads as "temporarily unavailable",
              which is a different and untrue claim.
            */
            <RowActions
              key="act"
              items={[
                { label: 'Send announcement', href: ROUTES.announcements },
                { label: 'Check in at the door', href: ROUTES.checkIn },
              ]}
            />,
          ])}
        />
        <Pagination total={rows.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
      </Panel>

      <Panel>
        <h2 className="section-header">Why this is two collections merged</h2>
        <p className="body-2">
          Whova has one attendee list that every registration product feeds. We have two collections
          doing different jobs. <code>registrations</code> is the imported ticket list, keyed by an
          opaque server-minted id rather than by email — because addresses change, because{' '}
          <code>&ldquo;a/b@example.com&rdquo;</code> is a legal address and an illegal Firestore
          path segment, and because an email-keyed collection is a membership oracle for anyone who
          can attempt a read. <code>users</code> is the profile someone creates when they sign in
          and claim a registration. This screen shows the <strong>union</strong> of the two, joined
          on the email address — the only key they share, and the reason{' '}
          <code>registrationId</code> is derived from a normalised address at all. It used to read{' '}
          <code>users</code> alone, which meant somebody who had bought a ticket five minutes ago
          was invisible here until they opened the app. The &ldquo;App&rdquo; column now carries
          that distinction instead of it deciding who appears.
        </p>
        <p className="body-2">
          The {hidden > 0 ? `${hidden} attendees marked "opted out" are` : 'opted-out column is'}{' '}
          about <code>directory/&#123;uid&#125;</code>, the slim ~450-byte projection every attendee
          may read. Opting out does not filter the profile out of the directory — it deletes the
          projection outright, so the record never reaches another device. Rules can hide documents
          but not fields, which is why the directory is a separate collection at all. The trigger
          that maintains it is unbuilt (Spark plan), so the projection is whatever the seed wrote.
        </p>
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Import — now built, in the shape the research recommended.</strong> Header
            detection, loose column matching, row-level errors numbered as the spreadsheet numbers
            them, and an upsert keyed on the email address, so re-running a file converges rather
            than duplicating. It calls the same <code>ensureRegistration</code> the Stripe webhook
            calls, which is what stops a fourth opinion about when to mint a badge secret.
            <br />
            Still missing from Whova&apos;s version: a manual column mapper for a file whose headers
            match nothing, and the 24-hour sync from Eventbrite and RegFox. Note Whova&apos;s own trap,
            that a blank Ticket Type column overwrites while every other blank merges — ours never
            overwrites a ticket type with a blank.
          </li>
          <li>
            <strong>Editing an attendee.</strong> Adding one is built — it writes a registration
            through the same <code>ensureRegistration</code> as the webhook and the importer, and
            re-adding an address updates rather than duplicates, which is the edit path for the
            three fields a registration owns. What is still missing is editing the <em>profile</em>:
            title, company, interests and photo live on <code>users/&#123;uid&#125;</code>, which
            the attendee also writes from the app, so an organizer edit needs a rule about who wins
            and a way to tell them it happened.
          </li>
          <li>
            <strong>Removing somebody from the event.</strong> The menu item was greyed out and is
            now gone rather than pretending. A registration has a <code>cancelled</code> status and
            flipping it by hand would be one line — but that status is also what a Stripe refund
            writes, and this screen tags a cancelled registration &ldquo;refunded&rdquo;. Adding a
            second, moneyless way to reach the same state means the tag lies for one of them, and a
            headcount that disagrees with the ledger is worse than a missing button. Cancelling a
            real ticket is a refund on Attendee Orders; cancelling a comp is a Firebase console job
            until the two states are separated in the model.
          </li>
          <li>
            <strong>Categories and Segments.</strong> Segments are the sharpest idea in the whole
            product — registration answers becoming operational cohorts that feed comms, badges and
            check-in counts with no configuration — and they need registration answers to derive
            from, which means Question Forms lands first.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
