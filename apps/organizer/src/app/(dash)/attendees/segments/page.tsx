import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { directoryUids } from '@/lib/cohorts';
import { listAttendees, type AttendeeRow } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { GapPanel, PER_PAGE, PageHeader, Pagination, Panel, SearchInput, Table, Tag, listParams, paginate, sortRows } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Segments.
 *
 * Whova's segments are the sharpest idea in the product: an answer to a
 * registration question becomes a named cohort with no configuration, and that
 * cohort is then a target for announcements, a field on the badge and a column
 * in the check-in count. "Everyone who ticked dietary: vegan" exists as an
 * object the moment the first person ticks it.
 *
 * **We have no registration answers.** Question Forms is unbuilt, there is no
 * answers store, and `gaps.ts` records segments as blocked behind it rather
 * than behind anything of their own. So none of what follows is that.
 *
 * What follows is the cohorts this data model can honestly produce: which tier
 * someone bought, whether they have opened the app, whether their profile
 * actually reached the directory, and how many colleagues came with them. Four
 * families, all **derived at read time from fields that exist for another
 * purpose**. None of them is authored, named, saved or targetable, and the
 * screen says so in every place it could be mistaken for otherwise.
 *
 * ── Every query behind this is one equality filter ──────────────────────────
 *
 * `listAttendees()` and `directoryUids()` each do a single
 * `where('eventId', '==', EVENT_ID)` and sort in memory. That filter is served
 * by Firestore's automatic single-field index; adding an `orderBy` would make
 * it a composite-index query this repo does not declare, and the emulator does
 * not enforce indexes, so it would pass locally and fail in production with
 * `failed-precondition`. Fifty attendees group in microseconds.
 */

interface Segment {
  /** `family:value`, stable enough to put in a URL. */
  key: string;
  label: string;
  /** What the number means, in one clause. Never a promise about what it can do. */
  note: string;
  members: AttendeeRow[];
}

interface Family {
  id: string;
  title: string;
  /** The field this is derived from, named so nobody mistakes it for an answer. */
  derivedFrom: string;
  caveat: string;
  segments: Segment[];
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

export default async function SegmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();

  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const seg = typeof sp.seg === 'string' ? sp.seg : undefined;
  const { page, sort, baseParams } = listParams(sp);

  const [all, listed] = await Promise.all([listAttendees(), directoryUids()]);

  // ── By ticket type ─────────────────────────────────────────────────────────
  //
  // Joined on the tier's *display name*, because that is what the importer
  // writes into `RegistrationDoc.ticketType` — a string, not a `ticketTypes`
  // document id. Renaming a tier in Ticket Setup therefore splits this segment
  // in two, with the old name still attached to everyone who bought before the
  // rename. That is a property of the data, not of this screen, and it is worth
  // knowing before anyone renames anything.
  const tierNames = [...new Set(all.map((a) => a.ticketType).filter(Boolean))].sort() as string[];
  const byTicket: Segment[] = [
    ...tierNames.map((t) => ({
      key: `ticket:${t}`,
      label: t,
      note: 'Holds this ticket type.',
      members: all.filter((a) => a.ticketType === t),
    })),
    {
      key: 'ticket:none',
      label: 'No ticket',
      note: 'Signed in but holds no ticket, such as staff.',
      members: all.filter((a) => !a.registrationId),
    },
  ];

  // ── By app adoption ────────────────────────────────────────────────────────
  const byApp: Segment[] = [
    {
      key: 'app:none',
      label: 'Ticket held, app not opened',
      note: 'Has not signed in, so has no profile and gets no notifications.',
      members: all.filter((a) => !a.signedIn),
    },
    {
      key: 'app:partial',
      label: 'Signed in, onboarding unfinished',
      note: 'Signed in but has not finished their profile.',
      members: all.filter((a) => a.signedIn && !a.onboarded),
    },
    {
      key: 'app:full',
      label: 'Signed in and onboarded',
      note: 'Has a complete profile.',
      members: all.filter((a) => a.signedIn && a.onboarded),
    },
    {
      key: 'app:messaging',
      label: 'Reachable by direct message',
      note: 'Allows direct messages. This is separate from being in the directory.',
      members: all.filter((a) => a.signedIn && a.messagingEnabled),
    },
  ];

  // ── By directory presence ──────────────────────────────────────────────────
  //
  // Two sources on purpose. `visibleInDirectory` is what the attendee asked
  // for; `directory/{uid}` is what another attendee's device can actually read.
  // The trigger that keeps them in step is unbuilt (Spark), so they drift — and
  // reporting the preference as though it were the directory is precisely the
  // defect class AGENTS.md counts fourteen instances of.
  const wants = all.filter((a) => a.signedIn && a.visibleInDirectory);
  const byDirectory: Segment[] = [
    {
      key: 'dir:listed',
      label: 'Listed in the directory',
      note: 'Other attendees can see them.',
      members: wants.filter((a) => a.uid && listed.has(a.uid)),
    },
    {
      key: 'dir:pending',
      label: 'Opted in, not listed yet',
      note: 'Chose to be listed but does not appear in the directory yet.',
      members: wants.filter((a) => !a.uid || !listed.has(a.uid)),
    },
    {
      key: 'dir:out',
      label: 'Opted out',
      note: 'Hidden from other attendees.',
      members: all.filter((a) => a.signedIn && !a.visibleInDirectory),
    },
    {
      key: 'dir:noprofile',
      label: 'Nothing to list yet',
      note: 'Has not signed in, so has made no choice.',
      members: all.filter((a) => !a.signedIn),
    },
  ];

  // ── By company size ────────────────────────────────────────────────────────
  //
  // "Size" here means how many people that company is *sending*, counted from
  // this attendee list. It is not headcount, revenue or any external notion of
  // company size, and it is only as good as a free-text field somebody typed
  // into their own profile: "IBM" and "I.B.M." are two companies to this count.
  const companyCount = new Map<string, number>();
  for (const a of all) {
    const c = norm(a.company);
    if (!c) continue;
    companyCount.set(c, (companyCount.get(c) ?? 0) + 1);
  }
  const sending = (a: AttendeeRow) => companyCount.get(norm(a.company)) ?? 0;
  const byCompany: Segment[] = [
    {
      key: 'co:group',
      label: 'From a company sending 5 or more',
      note: 'A large group from one company.',
      members: all.filter((a) => sending(a) >= 5),
    },
    {
      key: 'co:small',
      label: 'From a company sending 2 to 4',
      note: 'A small group from one company.',
      members: all.filter((a) => sending(a) >= 2 && sending(a) < 5),
    },
    {
      key: 'co:solo',
      label: 'The only one from their company',
      note: 'Came alone.',
      members: all.filter((a) => sending(a) === 1),
    },
    {
      key: 'co:unknown',
      label: 'No company recorded',
      note: 'No company on the profile or the ticket.',
      members: all.filter((a) => !norm(a.company)),
    },
  ];

  const families: Family[] = [
    {
      id: 'ticket',
      title: 'By ticket type',
      derivedFrom: 'RegistrationDoc.ticketType',
      caveat:
        'Grouped by ticket name. Renaming a ticket type splits its group in two.',
      segments: byTicket,
    },
    {
      id: 'app',
      title: 'By app adoption',
      derivedFrom: 'whether a users document exists, and its onboarded flag',
      caveat:
        'Whether they have ever signed in, not whether they are active today.',
      segments: byApp,
    },
    {
      id: 'dir',
      title: 'By directory presence',
      derivedFrom: 'UserDoc.visibleInDirectory compared against directory/{uid}',
      caveat:
        'Who other attendees can find in the app.',
      segments: byDirectory,
    },
    {
      id: 'co',
      title: 'By company size',
      derivedFrom: 'how many attendees share a company name',
      caveat:
        'Company names are typed by attendees, so two spellings count as two companies.',
      segments: byCompany,
    },
  ];

  const selected = families.flatMap((f) => f.segments).find((s) => s.key === seg);

  const needle = (q ?? '').trim().toLowerCase();
  const source = selected ? selected.members : all;
  const matched = source.filter((a) => {
    if (!needle) return true;
    return [a.name, a.email, a.title, a.company, a.ticketType]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });
  const rows = sortRows(matched, sort.by, sort.dir, {
    name: (a) => a.name,
    company: (a) => a.company ?? '',
    ticket: (a) => a.ticketType ?? '',
    signedin: (a) => (a.signedIn ? 1 : 0),
  });
  const pageRows = paginate(rows, page, PER_PAGE);

  const pct = (n: number) => (all.length === 0 ? '0%' : `${Math.round((n / all.length) * 100)}%`);
  const href = (next: { q?: string; seg?: string }) => {
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.seg) p.set('seg', next.seg);
    const s = p.toString();
    return s ? `?${s}` : '/attendees/segments';
  };

  return (
    <>
      <PageHeader
        title="Segments"
        info={
          <>
            <strong>Built-in segments</strong>
            <p>These groups are worked out from your attendee list. Custom segments are not available yet.</p>
          </>
        }
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="c" href="/attendees/categories">
            Categories
          </Link>,
          <Link key="t" href={ROUTES.createTickets}>
            Ticket Setup
          </Link>,
        ]}
      />

      <Panel>
        <p className="body-2">
          {all.length} attendees, grouped four ways. Each person appears once in every group.
        </p>
      </Panel>

      {families.map((f) => (
        <Panel key={f.id}>
          <h2 className="section-header">{f.title}</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
            {f.caveat}
          </p>
          <Table
            cols={[
              { key: 's', label: 'Segment', className: 'cell-mdsm' },
              { key: 'n', label: 'Attendees', className: 'cell-xs' },
              { key: 'p', label: 'Share', className: 'cell-xs' },
              { key: 'w', label: 'What it means', className: 'cell-fill' },
              { key: 'v', label: '', className: 'cell-xs cell-end-align' },
            ]}
            empty="No attendees yet"
            rows={f.segments.map((s) => [
              <span key="s">
                <strong>{s.label}</strong>
                {s.key === 'dir:pending' && s.members.length > 0 && (
                  <div>
                    <Tag color="orange" small>
                      not listed yet
                    </Tag>
                  </div>
                )}
              </span>,
              <strong key="n">{s.members.length}</strong>,
              <span key="p" className="muted">
                {pct(s.members.length)}
              </span>,
              <span key="w" style={{ fontSize: 13 }}>
                {s.note}
              </span>,
              s.members.length > 0 ? (
                <Link key="v" className="btn btn-default btn-sm" href={href({ q, seg: s.key })}>
                  View
                </Link>
              ) : (
                <span key="v" className="muted">
                  —
                </span>
              ),
            ])}
          />
        </Panel>
      ))}

      <Panel>
        <h2 className="section-header">
          {selected ? `Who is in “${selected.label}”` : 'Everyone in the attendee list'}
        </h2>
        {selected ? (
          <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>
            {selected.note}
          </p>
        ) : null}

        <form method="get" className="toolbar">
          {seg ? <input type="hidden" name="seg" value={seg} /> : null}
          <SearchInput defaultValue={q} width={420} placeholder="Enter name, email or company" />
          <button type="submit" className="btn btn-default">
            Search
          </button>
          {q || seg ? (
            <Link className="btn btn-default" href="/attendees/segments">
              Clear
            </Link>
          ) : null}
        </form>

        <Table
          cols={[
            { key: 'n', label: 'Name', className: 'cell-mdsm', sortKey: 'name' },
            { key: 'co', label: 'Company', className: 'cell-mdsm cell-truncate', sortKey: 'company' },
            { key: 't', label: 'Ticket', className: 'cell-sm', sortKey: 'ticket' },
            { key: 'app', label: 'App', className: 'cell-xs', sortKey: 'signedin' },
            { key: 'd', label: 'Directory', className: 'cell-sm' },
          ]}
          sort={sort}
          empty="Nobody matches that"
          rows={pageRows.map((a) => [
            <span key="n">
              <strong>{a.name}</strong>
              <div className="muted" style={{ fontSize: 12 }}>
                {a.email}
              </div>
            </span>,
            a.company ?? <span className="muted">—</span>,
            a.ticketType ?? <span className="muted">no ticket</span>,
            a.signedIn ? (
              <Tag key="app" color="green" fill="outline" small>
                yes
              </Tag>
            ) : (
              <Tag key="app" color="grey" fill="outline" small>
                not yet
              </Tag>
            ),
            !a.signedIn ? (
              <span key="d" className="muted">
                not signed in
              </span>
            ) : !a.visibleInDirectory ? (
              <Tag key="d" color="red" small>
                opted out
              </Tag>
            ) : a.uid && listed.has(a.uid) ? (
              'listed'
            ) : (
              <Tag key="d" color="orange" small>
                not listed yet
              </Tag>
            ),
          ])}
        />
        <Pagination total={rows.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Segments from registration answers.</strong> The actual feature. Needs Question
            Forms first — a form builder, an answers store, and the derivation on top of it. Roughly
            6–9 days for the forms and 3–4 for the segments, and note Whova&apos;s rule that a form
            locks after the first response, which exists because a question edited mid-sale silently
            re-labels everyone who already answered.
          </li>
          <li>
            <strong>Saving a segment.</strong> There is no segment object in <code>models.ts</code>{' '}
            and nothing writes one. Every group above is a filter evaluated on this request and
            thrown away when the page finishes rendering.
          </li>
          <li>
            <strong>Sending to a segment.</strong> Announcements go to the whole event — the
            announcement path has no audience filter at all, and the push sender addresses tokens
            rather than cohorts. A &ldquo;message this segment&rdquo; button would need both an
            audience field on the announcement and the app to honour it.
          </li>
          <li>
            <strong>Segments on the badge or at the door.</strong> Whova prints a segment on the
            badge and counts by it at check-in. <code>badgeTemplates</code> and{' '}
            <code>badgePrintJobs</code> are modelled and nothing writes them, and the check-in lists
            are fixed rather than derived.
          </li>
          <li>
            <strong>Add-on purchases as a segment.</strong> Whova segments by what someone bought on
            top of a ticket. <code>OrderDoc.items</code> carries the lines, but there are no add-on
            products in <code>ticketTypes</code> to buy — a tier includes workshops or it does not.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
