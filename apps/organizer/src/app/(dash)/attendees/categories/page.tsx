import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listAttendees, type AttendeeRow } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import {
  PER_PAGE,
  PageHeader,
  Pagination,
  Panel,
  SearchInput,
  StatTiles,
  Table,
  Tag,
  listParams,
  paginate,
  sortRows,
} from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Categories.
 *
 * Whova's categories are an organizer-authored label — you create "VIP" or
 * "Press", assign people to it, and it then drives badge printing, session
 * access and who a message goes to. Ours are not authored: they are
 * `UserDoc.roles`, the list this project already keeps because a speaker is
 * also an attendee, surfaced as the cohorts they already are.
 *
 * That is a smaller thing than Whova's and it is labelled as one. What it is
 * not is invented — `Role` is a closed union of six, exactly one of which
 * (`organizer`) `firestore.rules` branches on, and an organizer asking "how
 * many speakers are coming" gets a real answer here rather than a form for
 * typing one into.
 *
 * ── Why there is no edit button ─────────────────────────────────────────────
 *
 * `users/{uid}.roles` is a **mirror**. The thing that decides anything is the
 * `roles` custom claim on the ID token: `firestore.rules` reads
 * `request.auth.token.roles`, never the document, and `hasRole()` /
 * `isOrganizer()` are built on it. Nothing in this dashboard mints a claim —
 * the only code in the repo that calls `setCustomUserClaims` is
 * `scripts/src/set-claims.ts`, run from a laptop as the stand-in for the
 * unbuilt `verifyOtp` Cloud Function.
 *
 * So a working "add to category" button here would write the document, leave
 * the claim untouched, and show a new speaker who has none of a speaker's
 * access. Worse, it would fail *quietly*: the row would look right. Even after
 * someone remembered to run the script, claims only land in a token at sign-in,
 * so the person would keep the old one for up to an hour. Read-only is the
 * honest shape until claim minting has a server to live on.
 *
 * ── One read, one equality filter ───────────────────────────────────────────
 *
 * `listAttendees()` is the only fetch, and it is two `where('eventId', '==',
 * EVENT_ID)` queries merged in memory. That filter is served by Firestore's
 * automatic single-field index; adding an `orderBy` would make it a
 * composite-index query this repo does not declare, and the emulator does not
 * enforce index configuration, so it would pass locally and fail in production
 * with `failed-precondition`. Grouping fifty attendees costs nothing.
 */

/**
 * The six members of `Role`, in the order an organizer thinks about them, with
 * what holding one actually does. Roles are read from the data rather than from
 * this table — a value the seed invents still gets a row — but the ones we know
 * about get an explanation instead of a shrug.
 */
const ROLE_MEANING: Record<string, string> = {
  attendee: 'The baseline. Everyone with a claimed ticket has it; it grants nothing extra.',
  speaker: 'Presenting. Held alongside attendee, never instead of it.',
  organizer:
    'Reads every user document and every draft, and is the gate on this dashboard. The only role that confers power.',
  reviewer: 'Modelled for programme review. Nothing in the rules or the app reads it yet.',
  exhibitor: 'Modelled for sponsor staff. Nothing in the rules or the app reads it yet.',
  checkin: 'Modelled for desk staff. Check-in writes are Admin-SDK only, so this reads nothing yet.',
};

/** Roles that `firestore.rules` actually branches on today. */
const ENFORCED = new Set(['organizer']);

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();

  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const cat = typeof sp.cat === 'string' ? sp.cat : undefined;
  const { page, sort, baseParams } = listParams(sp);

  const all = await listAttendees();

  /**
   * Every role value present in the data, not a hard-coded list. If the seed or
   * an import writes a role this file has never heard of, it gets a row with a
   * blank meaning rather than vanishing — a category nobody can see is exactly
   * how a mis-typed role survives for a year.
   */
  const present = [...new Set(all.flatMap((a) => a.roles))].sort();

  const inCategory = (a: AttendeeRow, c: string) =>
    c === '(none)' ? a.roles.length === 0 : a.roles.includes(c);

  const categories = [
    ...present.map((c) => ({ key: c, label: c, known: c in ROLE_MEANING })),
    // Uncategorised is a real cohort and the largest one here, so it is a row
    // rather than a footnote. Almost all of it is ticket holders who have not
    // signed in: `roles` lives on `users`, and they have no `users` document.
    { key: '(none)', label: 'Uncategorised', known: true },
  ].map((c) => {
    const members = all.filter((a) => inCategory(a, c.key));
    return {
      ...c,
      size: members.length,
      signedIn: members.filter((m) => m.signedIn).length,
      ticketHolders: members.filter((m) => m.registrationId).length,
    };
  });

  const needle = (q ?? '').trim().toLowerCase();
  const matched = all.filter((a) => {
    if (cat && !inCategory(a, cat)) return false;
    if (!needle) return true;
    return [a.name, a.email, a.title, a.company, a.roles.join(' ')]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });

  const rows = sortRows(matched, sort.by, sort.dir, {
    name: (a) => a.name,
    company: (a) => a.company ?? '',
    category: (a) => a.roles.join(', '),
    signedin: (a) => (a.signedIn ? 1 : 0),
  });
  const pageRows = paginate(rows, page, PER_PAGE);

  const categorised = all.filter((a) => a.roles.length > 0).length;
  const multi = all.filter((a) => a.roles.length > 1).length;

  const href = (next: { q?: string; cat?: string }) => {
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.cat) p.set('cat', next.cat);
    const s = p.toString();
    return s ? `?${s}` : '/attendees/categories';
  };

  return (
    <>
      <PageHeader
        title="Categories"
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="s" href="/attendees/segments">
            Segments
          </Link>,
        ]}
      />

      <Panel>
        <StatTiles
          tiles={[
            { label: 'Categories in use', value: present.length, sub: `of 6 the model defines` },
            {
              label: 'Attendees categorised',
              value: categorised,
              sub: `${all.length - categorised} have no category`,
            },
            {
              label: 'In more than one',
              value: multi,
              sub: 'roles is a list — a speaker is also an attendee',
            },
          ]}
        />

        <Table
          cols={[
            { key: 'c', label: 'Category', className: 'cell-sm' },
            { key: 'n', label: 'Attendees', className: 'cell-xs' },
            { key: 'a', label: 'In the app', className: 'cell-xs' },
            { key: 'm', label: 'What holding it does', className: 'cell-fill' },
            { key: 'v', label: '', className: 'cell-xs cell-end-align' },
          ]}
          empty="No roles are set on any attendee"
          rows={categories.map((c) => [
            <span key="c">
              <strong>{c.label}</strong>
              {ENFORCED.has(c.key) && (
                <div>
                  <Tag color="blue" small>
                    enforced in rules
                  </Tag>
                </div>
              )}
            </span>,
            <span key="n">
              <strong>{c.size}</strong>
              {all.length > 0 && (
                <span className="muted"> ({Math.round((c.size / all.length) * 100)}%)</span>
              )}
            </span>,
            c.signedIn === c.size ? (
              String(c.signedIn)
            ) : (
              <span key="a">
                {c.signedIn}
                <span className="muted"> of {c.size}</span>
              </span>
            ),
            c.key === '(none)' ? (
              <span key="m">
                No <code>users</code> document, or one with an empty <code>roles</code>. Mostly
                ticket holders who have not opened the app — {c.ticketHolders} of these {c.size}{' '}
                hold a ticket.
              </span>
            ) : (
              (ROLE_MEANING[c.key] ?? (
                <span key="m" className="muted">
                  Not one of the six values <code>Role</code> defines. Came in with the data.
                </span>
              ))
            ),
            <Link key="v" className="btn btn-default btn-sm" href={href({ q, cat: c.key })}>
              View
            </Link>,
          ])}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">
          {cat ? `Who is in ${cat === '(none)' ? 'no category' : cat}` : 'Everyone, by category'}
        </h2>

        <form method="get" className="toolbar">
          {cat ? <input type="hidden" name="cat" value={cat} /> : null}
          <SearchInput
            defaultValue={q}
            width={420}
            placeholder="Enter name, email, company or category"
          />
          <button type="submit" className="btn btn-default">
            Search
          </button>
          {q || cat ? (
            <Link className="btn btn-default" href="/attendees/categories">
              Clear
            </Link>
          ) : null}
        </form>

        <Table
          cols={[
            { key: 'n', label: 'Name', className: 'cell-mdsm', sortKey: 'name' },
            { key: 'co', label: 'Company', className: 'cell-mdsm cell-truncate', sortKey: 'company' },
            { key: 'cat', label: 'Category', className: 'cell-fill', sortKey: 'category' },
            { key: 'app', label: 'App', className: 'cell-xs', sortKey: 'signedin' },
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
            a.roles.length > 0 ? (
              <span key="cat" style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                {a.roles.map((r) => (
                  <Tag key={r} color={r === 'organizer' ? 'blue' : 'grey'} small>
                    {r}
                  </Tag>
                ))}
              </span>
            ) : (
              <span key="cat" className="muted">
                {a.signedIn ? 'signed in, no role set' : 'no profile yet'}
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
          ])}
        />
        <Pagination total={rows.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
      </Panel>

      <Panel>
        <h2 className="section-header">Why this screen only reads</h2>
        <p className="body-2">
          The category shown against a person is <code>users/&#123;uid&#125;.roles</code>, and that
          document decides nothing. <code>firestore.rules</code> gates on the <code>roles</code>{' '}
          <strong>custom claim</strong> carried in the ID token —{' '}
          <code>request.auth.token.roles</code> — and never reads the profile to work out who you
          are, deliberately: an earlier version did, which cost a document read per rule evaluation
          and counted against the hard cap of ten access calls per request.
        </p>
        <p className="body-2">
          Nothing in this dashboard mints a claim. The only code in the repo that calls{' '}
          <code>setCustomUserClaims</code> is <code>scripts/src/set-claims.ts</code>, run from a
          laptop as the stand-in for the <code>verifyOtp</code> Cloud Function that Spark cannot
          deploy. An &ldquo;add to category&rdquo; button here would therefore write the mirror,
          leave the claim alone, and display a speaker with none of a speaker&apos;s access — a row
          that looks correct and is not. Claims also only refresh when a token is issued, so even
          after someone ran the script the person would carry the old one until they signed out and
          back in, for up to an hour.
        </p>
        <p className="body-2">
          Of the six values <code>Role</code> defines, exactly one changes behaviour today:{' '}
          <code>organizer</code>, which opens every user document and every draft and is the gate on
          this dashboard. <code>reviewer</code>, <code>exhibitor</code> and <code>checkin</code> are
          modelled and read by nothing — <code>checkin</code> in particular grants no check-in
          rights, because every write under <code>checkInLists</code> and <code>scanEvents</code> is
          denied to all clients and made with the Admin SDK instead.
        </p>
      </Panel>

      <Panel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Creating a category.</strong> Whova&apos;s are free text on the event, ours are a
            closed union of six in <code>models.ts</code>. Adding a seventh is a shared-package
            change plus a rules review, not a form.
          </li>
          <li>
            <strong>Assigning one.</strong> Needs a trusted server that can mint the{' '}
            <code>roles</code> claim in the same operation, or the mirror and the token drift. That
            is the same missing piece as OTP sign-in.
          </li>
          <li>
            <strong>Categories doing anything.</strong> In Whova a category gates session access,
            prints on the badge and targets an announcement. Here badge printing is modelled and
            unwritten (<code>badgeTemplates</code>, <code>badgePrintJobs</code>), announcements go to
            everyone with no audience filter, and session access is not modelled per person at all —
            see Ticket Session Mapping for the two booleans that are the whole of it.
          </li>
          <li>
            <strong>Bulk import of categories.</strong> The generic CSV importer in{' '}
            <code>@kgc/scripts</code> can set <code>roles</code> on <code>users</code>, but it writes
            the mirror only, with the same drift.
          </li>
        </ul>
      </Panel>
    </>
  );
}
