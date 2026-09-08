import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listCalls } from '@/lib/calls';
import { listRooms } from '@/lib/data';
import { listSubmissions } from '@/lib/submissions';
import { ROUTES } from '@/lib/nav';
import { Banner, NotInputted, PageHeader, Panel, Tag } from '../../../../ui';
import { PromoteForm } from './promote-form';

export const dynamic = 'force-dynamic';

const CFA_BASE = '/content/call-for-speakers-abstracts';

/**
 * Content › Agenda Center › Session Manager › From accepted submissions.
 *
 * ── Whova's marketing and Whova's help centre disagree, and this follows the
 *    help centre ─────────────────────────────────────────────────────────────
 *
 * The marketing says accepting a speaker submission synchronises it with the
 * agenda. The help centre says *"Accepting a speaker submission will not
 * automatically synchronize with your Agenda"*, and the help centre is right —
 * a session needs a day, a start, an end and a room, and acceptance decides none
 * of those. `CFA-PLAN.md` §4 records the argument; this screen is it.
 *
 * So promotion is a deliberate step, taken from inside Session Manager, where
 * the person doing it can see what else is happening at that hour.
 *
 * ── An author who is already a speaker updates that speaker ────────────────
 *
 * `promoteSubmission` derives the speaker id with `speakerId(name, company)` —
 * the same function the CSV importer and the seed use — so somebody accepted for
 * a second talk gains a session rather than a doppelgänger on the public page.
 * That is the whole reason those ids are derived rather than random.
 *
 * ── The session lands as a draft ───────────────────────────────────────────
 *
 * Not published. Promotion puts the talk on the organizer's agenda so it can be
 * scheduled against everything else; announcing it to a thousand phones is a
 * separate decision, usually made once the whole programme hangs together.
 */
export default async function FromAcceptedSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  await requireOrganizer();
  const { id } = await searchParams;

  const calls = await listCalls();
  const perCall = await Promise.all(
    calls.map(async (call) => ({ call, rows: await listSubmissions(call.id) })),
  );

  const accepted = perCall.flatMap(({ call, rows }) =>
    rows
      .filter((r) => r.status === 'accepted')
      .map((r) => ({ row: r, callTitle: call.title })),
  );
  const waiting = accepted.filter(({ row }) => !row.sessionId);
  const done = accepted.filter(({ row }) => row.sessionId);

  const chosen = id ? waiting.find(({ row }) => row.id === id) : undefined;
  const rooms = chosen ? await listRooms() : [];

  return (
    <>
      <PageHeader
        title="From accepted submissions"
        info={
          <>
            <strong>Acceptance is not scheduling</strong>
            <p>
              Nothing reaches the agenda when a submission is accepted. A session needs a day, a
              time and a room, and this is where those are decided.
            </p>
          </>
        }
        tags={
          waiting.length > 0 ? (
            <Tag color="orange">
              {waiting.length} waiting
            </Tag>
          ) : null
        }
        links={[
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="c" href={`${CFA_BASE}/submissions`}>
            Submissions
          </Link>,
        ]}
      />

      {calls.length === 0 ? (
        <Panel>
          <NotInputted what="call for abstracts" />
          <p className="body-2" style={{ marginBottom: 0 }}>
            This screen turns accepted abstracts into sessions. There is no call yet, so there is
            nothing to promote. A programme assembled elsewhere still comes in through the CSV
            importer on Session Manager, which is unaffected by any of this.
          </p>
        </Panel>
      ) : chosen ? (
        <Panel>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            {chosen.row.title}
          </h2>
          <p className="body-2">
            {chosen.row.author ? (
              <>
                By <strong>{chosen.row.author.name}</strong>
                {chosen.row.author.affiliation ? `, ${chosen.row.author.affiliation}` : ''}. They
                will be created as a speaker, or (if somebody of that name and affiliation is
                already on the bill) that speaker gains this session rather than appearing twice.
              </>
            ) : (
              <>⚠️ There is no author on file for this submission, so it cannot be promoted.</>
            )}
          </p>
          <p className="body-2">
            Offered as a <strong>{chosen.row.sessionType ?? 'talk'}</strong>. The abstract becomes
            the session description; the session is created as a <strong>draft</strong> so nothing
            reaches an attendee&rsquo;s phone until you publish it.
          </p>

          {chosen.row.author && (
            <PromoteForm submissionId={chosen.row.id} title={chosen.row.title} rooms={rooms} />
          )}

          <p style={{ marginTop: 16 }}>
            <Link href="/content/agenda-center/session-manager/from-accepted">
              Back to the list
            </Link>
          </p>
        </Panel>
      ) : (
        <>
          {accepted.length === 0 && (
            <Banner kind="info">
              <strong>Nothing has been accepted yet.</strong> Decisions are made on{' '}
              <Link href={`${CFA_BASE}/submissions`}>Submissions</Link>; accepted work appears here
              afterwards, waiting for a time and a room.
            </Banner>
          )}

          <Panel>
            <h2 className="section-header" style={{ marginTop: 0 }}>
              Waiting for a slot
            </h2>
            {waiting.length === 0 ? (
              <NotInputted what="accepted submissions without a session" compact />
            ) : (
              <ul className="body-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {waiting.map(({ row, callTitle }) => (
                  <li
                    key={row.id}
                    style={{
                      alignItems: 'baseline',
                      borderBottom: '1px solid var(--hairline)',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 12,
                      padding: '10px 0',
                    }}
                  >
                    <Link href={`?id=${row.id}`} style={{ flex: '1 1 320px' }}>
                      <strong>{row.title}</strong>
                    </Link>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {row.author?.name ?? 'no author on file'} · {row.sessionType ?? 'talk'} ·{' '}
                      {callTitle}
                    </span>
                    <Link className="whova-btn-main small" href={`?id=${row.id}`}>
                      Schedule it
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {done.length > 0 && (
            <Panel style={{ marginTop: 16 }}>
              <h2 className="section-header" style={{ marginTop: 0 }}>
                Already on the agenda
              </h2>
              <ul className="body-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {done.map(({ row }) => (
                  <li key={row.id} style={{ padding: '6px 0' }}>
                    <Link href={`${ROUTES.sessionManager}/${row.sessionId}`}>{row.title}</Link>{' '}
                    <span className="muted" style={{ fontSize: 12 }}>
                      — {row.author?.name ?? 'no author on file'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                Each of these holds a <code>sessionId</code>, which is what makes pressing the
                button twice harmless: a second promotion is refused rather than producing a
                duplicate session beside the first.
              </p>
            </Panel>
          )}
        </>
      )}
    </>
  );
}
