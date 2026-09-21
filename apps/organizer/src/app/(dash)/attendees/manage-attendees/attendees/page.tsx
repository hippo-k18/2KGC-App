import Link from 'next/link';
import { COLLECTIONS } from '@kgc/shared';
import { getAttendeeForEdit } from '@/lib/attendee-admin';
import { attendeeCategories } from '@/lib/attendee-categories';
import { UNCATEGORISED, categoryCounts, categoryLabel, inCategory } from '@/lib/attendee-categories-core';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes } from '@/lib/commerce';
import { countWhereEvent, listAttendees } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { personRefParam } from '@/lib/person-data-core';
import { GapPanel, PER_PAGE, PageHeader, Pagination, Panel, SearchInput, Table, Tag, listParams, paginate, sortRows } from '../../../ui';
import { Dropdown, RowActions } from '../../../menu';
import { AssignBar, RowCheckbox } from '../../categories/assign-bar';
import { AddAttendeeForm } from './add-form';
import { EditPanel } from './edit-panel';
import { ImportForm } from './import-form';
import { PersonDataPanel } from './person-data-panel';

export const dynamic = 'force-dynamic';

const ASSIGN_FORM = 'assign-category';

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
  const category = typeof sp.category === 'string' ? sp.category : undefined;
  const { page, sort, baseParams } = listParams(sp);
  const importing = typeof sp.import === 'string';
  const adding = typeof sp.add === 'string';
  const editId = typeof sp.edit === 'string' ? sp.edit : undefined;
  // `reg:{id}` or `uid:{id}` — the row says which half of the union it came
  // from, because a bare id would have to be guessed at and guessing wrong
  // opens somebody else's file.
  const dataRef = typeof sp.data === 'string' ? sp.data : undefined;
  const [all, registrations, catalogue, editing, { categories }] = await Promise.all([
    listAttendees(),
    countWhereEvent(COLLECTIONS.registrations),
    listTicketTypes(),
    editId ? getAttendeeForEdit(editId) : null,
    attendeeCategories(),
  ]);

  const needle = (q ?? '').trim().toLowerCase();
  const matched = all.filter((a) => {
    if (role && !a.roles.includes(role)) return false;
    if (!inCategory(a, category)) return false;
    if (!needle) return true;
    return [a.name, a.email, a.title, a.company, a.ticketType, categoryLabel(categories, a), ...a.interests]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });

  const rows = sortRows(matched, sort.by, sort.dir, {
    name: (a) => a.name,
    title: (a) => a.title ?? '',
    company: (a) => a.company ?? '',
    category: (a) => categoryLabel(categories, a),
    ticket: (a) => a.ticketType ?? '',
    signedin: (a) => (a.signedIn ? 1 : 0),
    directory: (a) => (a.visibleInDirectory ? 1 : 0),
  });
  const pageRows = paginate(rows, page, PER_PAGE);

  // Counted over ticket holders: the category is on the registration, so
  // somebody with a profile and no ticket cannot have one.
  const { counts, uncategorised } = categoryCounts(categories, all.filter((a) => a.registrationId));
  // The ticket types already in use, rather than the sales catalogue: the point
  // of the select is that a hand-added attendee lands in the same bucket as the
  // people who bought, and "Main Conference " with a trailing space is two
  // buckets in every breakdown with nothing anywhere to flag it.
  const ticketTypes = [...new Set(all.map((a) => a.ticketType).filter(Boolean) as string[])].sort();
  // Changing a ticket type also offers what is on sale and nobody holds yet.
  const changeTo = [...new Set([...catalogue.map((t) => t.name), ...ticketTypes])];
  // Title and company fall back to the attendee's own profile, so saving a
  // corrected name does not blank what they wrote about themselves.
  const editRow = editing ? all.find((a) => a.registrationId === editing.registrationId) : undefined;
  const hidden = all.filter((a) => a.signedIn && !a.visibleInDirectory).length;
  const signedIn = all.filter((a) => a.signedIn).length;
  const ticketHolders = all.filter((a) => a.registrationId).length;
  const exportQuery = category ? `?category=${encodeURIComponent(category)}` : '';
  const href = (next: { q?: string; role?: string; category?: string }) => {
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.role) p.set('role', next.role);
    if (next.category) p.set('category', next.category);
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
                  ({Math.round((signedIn / all.length) * 100)}%). {all.length - signedIn} have not
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
            of `users` The profile they create at sign-in… and not of a
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
              // A category filter on the list carries into the file.
              { label: 'Export basic attendee list', href: `/export/attendees${exportQuery}` },
              { label: 'Export badge and catering list', href: `/export/catering${exportQuery}` },
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

        {editId && (
          <div
            id="edit"
            style={{
              background: 'var(--surface-alt)',
              border: '1px solid var(--hairline)',
              borderRadius: 4,
              marginBottom: 16,
              padding: 16,
            }}
          >
            <div style={{ alignItems: 'baseline', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 15, marginTop: 0 }}>
                {editing ? `Edit ${editing.name || editing.email}` : 'Edit attendee'}
              </h2>
              <Link href={ROUTES.attendees}>Close</Link>
            </div>
            {editing ? (
              <EditPanel
                key={editing.registrationId}
                attendee={{
                  ...editing,
                  title: editing.title || editRow?.title || '',
                  company: editing.company || editRow?.company || '',
                }}
                ticketTypes={changeTo}
                categories={categories}
                emailReady={Boolean(process.env.RESEND_API_KEY)}
              />
            ) : (
              <p className="body-2" style={{ marginBottom: 0 }}>
                That attendee is no longer on the list.
              </p>
            )}
          </div>
        )}

        {dataRef && <PersonDataPanel param={dataRef} />}

        <form method="get" className="toolbar">
          {role ? <input type="hidden" name="role" value={role} /> : null}
          {category ? <input type="hidden" name="category" value={category} /> : null}
          <SearchInput
            defaultValue={q}
            width={460}
            placeholder="Enter name, email, company, titles, location or category"
          />
          <button type="submit" className="btn btn-default">
            Search
          </button>
          {q ? (
            <Link className="btn btn-default" href={href({ role, category })}>
              Clear
            </Link>
          ) : null}
        </form>

        <div className="toolbar">
          <Link
            className={`whova-tag-main ${!category ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
            href={href({ q })}
            style={{ textDecoration: 'none' }}
          >
            All Attendees ({all.length})
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              className={`whova-tag-main ${c.id === category ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
              href={href({ q, category: c.id })}
              style={{ textDecoration: 'none' }}
            >
              {c.name} ({counts[c.id]})
            </Link>
          ))}
          <Link
            className={`whova-tag-main ${category === UNCATEGORISED ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
            href={href({ q, category: UNCATEGORISED })}
            style={{ textDecoration: 'none' }}
          >
            No category ({uncategorised})
          </Link>
        </div>

        <AssignBar formId={ASSIGN_FORM} categories={categories} />

        <Table
          stackSm
          cols={[
            { key: 'sel', label: 'Select', className: 'cell-xs' },
            { key: 'n', label: 'Name', className: 'cell-mdsm', sortKey: 'name' },
            { key: 't', label: 'Title', className: 'cell-fill', sortKey: 'title' },
            { key: 'c', label: 'Company', className: 'cell-mdsm cell-truncate', sortKey: 'company' },
            { key: 'tk', label: 'Ticket', className: 'cell-sm', sortKey: 'ticket' },
            { key: 'cat', label: 'Category', className: 'cell-sm', sortKey: 'category' },
            { key: 'app', label: 'App', className: 'cell-xs', sortKey: 'signedin' },
            { key: 's', label: 'Directory', className: 'cell-sm', sortKey: 'directory' },
            { key: 'act', label: '', className: 'cell-xs cell-end-align' },
          ]}
          sort={sort}
          empty="No attendee matches that search"
          rows={pageRows.map((a) => [
            // The category is on the registration, so only a ticket holder can be ticked.
            a.registrationId && a.registrationStatus === 'active' ? (
              <RowCheckbox key="sel" formId={ASSIGN_FORM} rid={a.registrationId} name={a.name} />
            ) : (
              <span key="sel" />
            ),
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
                {a.registrationStatus && a.registrationStatus !== 'active' && (
                  <div>
                    <Tag color="red" small>
                      {a.registrationStatus}
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
            a.categoryId ? (
              <Tag
                key="cat"
                color={categories.find((c) => c.id === a.categoryId)?.color ?? 'grey'}
                fill="solid"
                small
              >
                {categoryLabel(categories, a)}
              </Tag>
            ) : (
              <span key="cat" className="muted">
                —
              </span>
            ),
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
              The edit items open the panel above the table for this row's
              registration. Somebody with a profile and no ticket has nothing
              here to edit, cancel or transfer, so they get the two links only.
            */
            <RowActions
              key="act"
              items={[
                ...(a.registrationId
                  ? a.registrationStatus === 'active'
                    ? [
                        { label: 'Edit attendee', href: `?edit=${a.registrationId}#edit` },
                        { label: 'Set category', href: `?edit=${a.registrationId}#category` },
                        { label: 'Transfer ticket', href: `?edit=${a.registrationId}#transfer` },
                        { label: 'Cancel registration', href: `?edit=${a.registrationId}#cancel`, danger: true },
                      ]
                    : [{ label: 'View registration', href: `?edit=${a.registrationId}#edit` }]
                  : []),
                { label: 'Send announcement', href: ROUTES.announcements },
                { label: 'Check in at the door', href: ROUTES.checkIn },
                /*
                  Both offered on every row, including somebody with a profile
                  and no ticket: a data request does not depend on having bought
                  anything, and the walk is keyed on five ids of which the
                  address is the only one always present.

                  The export is a direct link because it is the common request
                  and the file is the answer to it. Deletion opens the panel
                  first, which lists what is held before it offers the button.
                */
                {
                  label: 'Export their data',
                  href: a.registrationId
                    ? `/export/person?rid=${encodeURIComponent(a.registrationId)}`
                    : `/export/person?uid=${encodeURIComponent(a.uid ?? '')}`,
                },
                {
                  label: 'Delete their data',
                  href: `?data=${personRefParam({ registrationId: a.registrationId, uid: a.uid })}#person-data`,
                  danger: true,
                },
              ]}
            />,
          ])}
        />
        <Pagination total={rows.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
      </Panel>

      <Panel>
        <h2 className="section-header">About this list</h2>
        <p className="body-2" style={{ marginBottom: 0 }}>
          The list includes everyone with a ticket and everyone who has signed into the app. App
          shows who has signed in. Directory shows who other attendees can see
          {hidden > 0 ? `; ${hidden} opted out` : ''}.
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
            <strong>Editing, cancelling and transferring, now built.</strong> An address change and a
            transfer both move the registration to the id derived from the new address and leave the
            old one as <code>transferred</code>. A cancellation releases a paid seat through{' '}
            <code>releasedSeats</code> on the order and does not refund it. Still missing: a ticket
            type change moves no stock and takes no payment, and a refund of a transferred
            ticket&apos;s order cancels the original holder&apos;s registration, not the new one.
          </li>
          <li>
            <strong>Export and deletion of one person, now built.</strong> Both walk the one list in{' '}
            <code>person-data-core.ts</code>, so a new collection is reached by adding an entry
            there and by nothing else. Still missing: the call for abstracts is a separate
            population reached by capability link with no account, and its submissions, reviewer
            rows and author identities are not in the walk yet. Neither is{' '}
            <code>gatherings.attendees</code>, which holds typed names rather than ids and has no
            join key to match on.
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
