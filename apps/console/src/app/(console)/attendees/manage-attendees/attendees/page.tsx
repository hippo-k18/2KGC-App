import Link from 'next/link';
import { COLLECTIONS } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { countWhereEvent, listAttendees } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * Attendees > Manage Attendees > Attendees — §10.3.
 *
 * Search is a filter over the whole list in memory, deliberately. It is the
 * same trade the attendee app's directory makes and for the same reason: at
 * these volumes an in-memory pass beats any query, needs no search service, and
 * cannot fail with `failed-precondition` because it declares no index. The
 * single `where('eventId', '==', …)` behind it is served by Firestore's
 * automatic single-field index.
 */
export default async function AttendeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string }>;
}) {
  await requireOrganizer();

  const { q, role } = await searchParams;
  const [all, registrations] = await Promise.all([
    listAttendees(),
    countWhereEvent(COLLECTIONS.registrations),
  ]);

  const needle = (q ?? '').trim().toLowerCase();
  const rows = all.filter((a) => {
    if (role && !a.roles.includes(role)) return false;
    if (!needle) return true;
    return [a.name, a.email, a.title, a.company, ...a.interests]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });

  const roles = [...new Set(all.flatMap((a) => a.roles))].sort();
  const hidden = all.filter((a) => !a.visibleInDirectory).length;

  return (
    <>
      <p className="crumbs">
        <Link href="/attendees">Attendees</Link> {' › '}
        <Link href="/attendees/manage-attendees">Manage Attendees</Link> {' › '}
      </p>
      <h1>Attendees</h1>
      <p className="muted">
        {rows.length} of {all.length} profiles in <code>users</code>, against {registrations}{' '}
        imported tickets in <code>registrations</code>. Those two are different things — see below.
      </p>

      <form method="get">
        <label htmlFor="q">Search name, email, title, affiliation or interests</label>
        <input id="q" name="q" defaultValue={q ?? ''} autoComplete="off" />
        {role ? <input type="hidden" name="role" value={role} /> : null}
        <button type="submit">Search</button>{' '}
        {q ? <Link href={role ? `?role=${role}` : '?'}>Clear</Link> : null}
      </form>

      <div className="filters">
        <Link href={q ? `?q=${encodeURIComponent(q)}` : '?'} aria-current={!role}>
          All roles
        </Link>
        {roles.map((r) => (
          <Link
            key={r}
            href={`?role=${r}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
            aria-current={r === role}
          >
            {r} ({all.filter((a) => a.roles.includes(r)).length})
          </Link>
        ))}
      </div>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Title</th>
            <th>Affiliation</th>
            <th>Roles</th>
            <th>In directory</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.uid}>
              <td>
                <strong>{a.name}</strong>
                <div className="muted">
                  <code>{a.uid}</code>
                </div>
              </td>
              <td>{a.email}</td>
              <td>{a.title ?? <span className="muted">—</span>}</td>
              <td>{a.company ?? <span className="muted">—</span>}</td>
              <td>{a.roles.join(', ')}</td>
              <td className={a.visibleInDirectory ? '' : 'error'}>
                {a.visibleInDirectory ? 'yes' : 'opted out'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="muted">No attendee matches that search.</p> : null}

      <h2>Why this is not the ticket list</h2>
      <p className="muted" style={{ maxWidth: 780 }}>
        Whova has one attendee list that every registration product feeds (§0). We have two
        collections doing different jobs. <code>registrations</code> is the imported ticket list,
        keyed by an opaque server-minted id rather than by email — because addresses change,
        because <code>&ldquo;a/b@example.com&rdquo;</code> is a legal address and an illegal
        Firestore path segment, and because an email-keyed collection is a membership oracle for
        anyone who can attempt a read. <code>users</code> is the profile someone creates when they
        sign in and claim a registration. The {registrations} and {all.length} above differ because
        not every ticket holder has signed in, which is exactly the number an organizer wants to
        watch in the week before the doors open.
      </p>
      <p className="muted" style={{ maxWidth: 780 }}>
        The {hidden > 0 ? `${hidden} attendees marked "opted out" are` : 'opted-out column is'}{' '}
        about <code>directory/&#123;uid&#125;</code>, the slim ~450-byte projection every attendee
        may read. Opting out does not filter the profile out of the directory — it deletes the
        projection outright, so the record never reaches another device. Rules can hide documents
        but not fields, which is why the directory is a separate collection at all. Note that the
        trigger which maintains it is unbuilt (Spark plan), so the projection is whatever the seed
        wrote.
      </p>

      <h2>Not built here</h2>
      <ul className="muted" style={{ maxWidth: 780 }}>
        <li>
          <strong>Import</strong> (§10.1) — three modes in Whova, including a real column mapper
          and a 24-hour sync from Eventbrite, RegFox and Constant Contact, with row-by-row error
          reporting. §35.3 says build one generic importer with header detection, column mapping,
          validation, row-level errors, upsert with a declared key and generated-ID handback: 6–9
          days once and half a day per entity afterwards, against 25+ days for eight bespoke ones.
          §34 flags the upsert semantics as where this balloons — note Whova&apos;s own trap, that
          a blank Ticket Type column overwrites while every other blank merges (§10.2).
        </li>
        <li>
          <strong>Add and edit an attendee</strong> (§10.3). Editing a profile from here means
          writing to a document the attendee also owns, so it needs a rule about who wins.
        </li>
        <li>
          <strong>Export</strong> (§10.3, §23.7) — one generic exporter, 3–4 days for every entity.
        </li>
        <li>
          <strong>Categories and Segments</strong> (§10.4). Segments are the sharpest idea in the
          whole product — registration answers becoming operational cohorts that feed comms, badges
          and check-in counts with no configuration — and they need registration answers to derive
          from.
        </li>
        <li>
          <strong>Check-in status.</strong> The paths are modelled for idempotency already
          (§14); nothing writes them yet.
        </li>
      </ul>
    </>
  );
}
