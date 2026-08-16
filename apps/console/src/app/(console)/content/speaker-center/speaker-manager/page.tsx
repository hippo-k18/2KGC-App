import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSpeakers } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * Content > Speaker Center > Speaker Manager — §7.
 *
 * §36 C3 is explicit about what earns this screen its place at 150 speakers:
 * the completeness column and the bulk reminder. The reminder needs an ESP and
 * Blaze; the completeness column needs nothing, so it is here. Filtering to the
 * incomplete ones is the one thing an organizer does with this list in the two
 * weeks before an event.
 */
export default async function SpeakerManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireOrganizer();

  const { filter } = await searchParams;
  const all = await listSpeakers();

  const noBio = all.filter((s) => !s.hasBio);
  const noPhoto = all.filter((s) => !s.hasPhoto);
  const noSession = all.filter((s) => s.sessionCount === 0);

  const rows =
    filter === 'no-bio'
      ? noBio
      : filter === 'no-photo'
        ? noPhoto
        : filter === 'no-session'
          ? noSession
          : all;

  return (
    <>
      <p className="crumbs">
        <Link href="/content">Content</Link> {' › '}
        <Link href="/content/speaker-center">Speaker Center</Link> {' › '}
      </p>
      <h1>Speaker Manager</h1>
      <p className="muted">
        {rows.length} of {all.length} speakers, sorted by name.
      </p>

      <div className="filters">
        <Link href="?" aria-current={!filter}>
          All ({all.length})
        </Link>
        <Link href="?filter=no-photo" aria-current={filter === 'no-photo'}>
          Missing photo ({noPhoto.length})
        </Link>
        <Link href="?filter=no-bio" aria-current={filter === 'no-bio'}>
          Missing bio ({noBio.length})
        </Link>
        <Link href="?filter=no-session" aria-current={filter === 'no-session'}>
          No session ({noSession.length})
        </Link>
      </div>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Title</th>
            <th>Affiliation</th>
            <th>Photo</th>
            <th>Bio</th>
            <th>Sessions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td>
                <strong>{s.name}</strong>
                {s.userId ? (
                  <div className="muted">
                    also attendee <code>{s.userId}</code>
                  </div>
                ) : null}
              </td>
              <td>{s.title ?? <span className="muted">—</span>}</td>
              <td>{s.company ?? <span className="muted">—</span>}</td>
              <td className={s.hasPhoto ? 'ok' : 'error'}>{s.hasPhoto ? 'yes' : 'no'}</td>
              <td className={s.hasBio ? 'ok' : 'error'}>{s.hasBio ? 'yes' : 'no'}</td>
              <td>
                {s.sessionCount === 0 ? (
                  <span className="error">none</span>
                ) : (
                  <>
                    {s.sessionCount}
                    <div className="muted">{s.sessionTitles.join('; ')}</div>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Two things worth knowing about this data</h2>
      <p className="muted" style={{ maxWidth: 780 }}>
        <strong>There is no speaker email address.</strong> <code>SpeakerDoc</code> in{' '}
        <code>packages/shared/src/models.ts</code> has name, photo, title, company, bio, socials,{' '}
        <code>sessionIds</code> and an optional <code>userId</code> — and no email. Every
        speaker-facing feature in §7 depends on one: the self-service form link (§7.4), the
        scheduled reminder email (§7.5), Message Speakers (§7.6), and Whova&apos;s rule that the
        Speakers tab only appears in the app once a speaker has both an email and a session (§7.7).
        Adding the field is trivial; deciding it is not, because a speaker email is personal data
        with a retention question attached, and it is the join key the duplicate hazard in §7.2
        turns on — Whova does no fuzzy matching, so an agenda import that spells a name differently
        silently creates a second speaker.
      </p>
      <p className="muted" style={{ maxWidth: 780 }}>
        <strong>Speaker role is per-session in Whova, not per-speaker</strong> (§7.3): the label on
        a session can be changed from &ldquo;Speakers&rdquo; to &ldquo;Chairs&rdquo; or
        &ldquo;Moderators&rdquo;. Our model has a flat <code>speakerIds</code> array on the session
        and no role, so a panel moderator and a panellist are indistinguishable.
      </p>

      <h2>Not built here</h2>
      <ul className="muted" style={{ maxWidth: 780 }}>
        <li>
          <strong>Add, edit, import and export speakers.</strong> §35.1 argues for importing 150
          speakers from the CFP export in one go and building the portal rather than a CRUD grid —
          a ~4 day saving. <code>scripts/src/import-whova.ts</code> is that importer.
        </li>
        <li>
          <strong>The speaker self-service portal</strong> (§7.4, §36 C4) — magic-link, edit your
          own record, upload a headshot and slides, tick a release consent, see a deadline. §34
          puts speaker records plus the portal at 7–9 days and says it pays for itself in week one
          at this many speakers. It is the highest-value unbuilt thing in this section.
        </li>
        <li>
          <strong>Bulk reminders to incomplete profiles</strong> (§7.5, §7.6). The filters above
          are the targeting half; the sending half needs an ESP with a verified domain called from
          Cloud Functions, which needs the Blaze plan.
        </li>
      </ul>
    </>
  );
}
