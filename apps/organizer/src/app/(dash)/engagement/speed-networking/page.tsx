import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listAttendees } from '@/lib/data';
import { buildSchedule, meetingCounts, repeatedPairs } from '@/lib/pairings-core';
import { Banner, PageHeader, Panel, StatTiles, Table, Tag } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Speed Networking.
 *
 * ── What the hard part actually is ─────────────────────────────────────────
 *
 * Not the app screen — the pairing. An organizer running speed networking has
 * a room, a timer and a list of people, and needs to know who sits opposite
 * whom each round. Doing it by hand is an afternoon; doing it randomly repeats
 * pairs while leaving other people never paired at all, and the repeat lands on
 * the two colleagues who arrived together.
 *
 * So this computes it, with the circle method: `n - 1` rounds in which
 * everybody meets everybody exactly once, and an odd person rests in rotation
 * rather than being folded into a three-way that will not fit the timer.
 * `tests/programme/pairings.test.ts` asserts the no-repeat guarantee rather
 * than this comment claiming it.
 *
 * ── Attendees do not see this, and it does not need them to ────────────────
 *
 * ⚠️ There is no app surface. The schedule is read from a screen, called over a
 * microphone and printed — which is how speed networking is actually run at an
 * in-person conference, so the missing app half costs less here than anywhere
 * else in this tab.
 *
 * ── The participant list is typed, not signed up ───────────────────────────
 *
 * Whoever turns up. That is genuinely the input: a session announced at lunch
 * is attended by the people in the room, not by whoever pressed a button a week
 * earlier. The attendee list below is a convenience for pasting, not a roster.
 */
export default async function SpeedNetworkingPage({
  searchParams,
}: {
  searchParams: Promise<{ names?: string; rounds?: string }>;
}) {
  await requireOrganizer();

  const params = await searchParams;
  const attendees = await listAttendees();

  const names = (params.names ?? '')
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);

  const requested = Math.max(1, Math.min(30, Number(params.rounds ?? 5) || 5));
  const schedule = buildSchedule(names, requested);
  const repeats = repeatedPairs(schedule);
  const counts = meetingCounts(schedule);

  /**
   * Fewest meetings anybody gets. On a partial schedule this differs from the
   * most by at most one, and showing both is how an organizer sees that nobody
   * was left out — which is the whole reason not to pair randomly.
   */
  const values = [...counts.values()];
  const fewest = values.length ? Math.min(...values) : 0;
  const most = values.length ? Math.max(...values) : 0;

  return (
    <>
      <PageHeader
        title="Speed Networking"
        tags={
          schedule.rounds.length > 0 ? (
            <Tag color={repeats.length === 0 ? 'green' : 'red'} fill="outline">
              {repeats.length === 0 ? 'no repeated pairs' : `${repeats.length} repeats`}
            </Tag>
          ) : (
            <Tag color="grey">no schedule</Tag>
          )
        }
        links={[
          <Link key="r" href="/engagement/round-table">
            Round Table
          </Link>,
          <Link key="m" href="/engagement/community/attendee-matchmaking">
            Attendee Matchmaking
          </Link>,
          <Link key="a" href="/attendees/manage-attendees/attendees">
            Attendees
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>The pairing is the hard part, and it is done here.</strong> Attendees see nothing —
        there is no app surface, and speed networking at an in-person conference is run from a
        printed sheet and a microphone anyway. What this gives you is a schedule where{' '}
        <strong>nobody meets the same person twice</strong> while somebody else meets nobody, which
        is what random pairing quietly fails to do.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Who is in the room</h2>
        {/*
          A GET form, so a schedule is a URL. An organizer who has one on screen
          can send the link to whoever is running the timer, and the back button
          works — which matters when the input is a list somebody typed.
        */}
        <form method="get">
          <div className="whova-form-row">
            <label className="whova-form-label" htmlFor="names">
              Names
            </label>
            <textarea
              id="names"
              name="names"
              rows={8}
              defaultValue={params.names ?? ''}
              placeholder={'One per line\nAda Lovelace\nGrace Hopper\nAlan Turing'}
              style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}
            />
            <p className="muted" style={{ fontSize: 12 }}>
              Whoever turns up — that is genuinely the input. Duplicates are dropped
              case-insensitively, because one person entered twice would otherwise be paired with
              themselves and nobody notices until it is printed.
            </p>
          </div>

          <div className="whova-form-row">
            <label className="whova-form-label" htmlFor="rounds">
              Rounds
            </label>
            <input
              id="rounds"
              name="rounds"
              type="number"
              min={1}
              max={30}
              defaultValue={requested}
              style={{ maxWidth: 100 }}
            />
            <p className="muted" style={{ fontSize: 12 }}>
              How many you have time for. At five minutes a round, six rounds is half an hour plus
              the shuffling. Asking for more than full cover needs is capped rather than repeating
              pairs.
            </p>
          </div>

          <button type="submit" className="whova-btn-main">
            Build the schedule
          </button>
        </form>

        {attendees.length > 0 && (
          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13 }}>
              Paste from the attendee list ({attendees.length} people)
            </summary>
            <p className="muted" style={{ fontSize: 12 }}>
              A convenience, not a roster — nobody here has signed up for anything. Copy the ones in
              the room.
            </p>
            <textarea
              readOnly
              rows={8}
              value={attendees.map((a) => a.name).join('\n')}
              style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, width: '100%' }}
            />
          </details>
        )}
      </Panel>

      {schedule.rounds.length > 0 && (
        <>
          <StatTiles
            tiles={[
              { label: 'People', value: schedule.people, sub: 'after de-duplication' },
              {
                label: 'Rounds',
                value: schedule.rounds.length,
                sub: schedule.complete
                  ? 'everybody meets everybody'
                  : `${schedule.roundsForFullCover} for full cover`,
              },
              {
                label: 'Meetings each',
                value: fewest === most ? fewest : `${fewest}–${most}`,
                sub: fewest === most ? 'identical for everybody' : 'differs by one at most',
              },
              {
                label: 'Repeated pairs',
                value: repeats.length,
                sub: repeats.length === 0 ? 'none, by construction' : 'a bug — please report it',
              },
            ]}
          />

          {!schedule.complete && (
            <Banner kind="info">
              <strong>
                {schedule.rounds.length} rounds of the {schedule.roundsForFullCover} it would take
                for everybody to meet everybody.
              </strong>{' '}
              Nobody is paired twice in what you have, and every person gets{' '}
              {fewest === most ? `${fewest} meetings` : `${fewest} or ${most} meetings`} — so the
              short schedule is fair, just not exhaustive.
            </Banner>
          )}

          <Panel style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>The schedule</h2>
            {schedule.rounds.map((round) => (
              <div key={round.number} style={{ marginBottom: 18 }}>
                <h3 className="section-header" style={{ marginBottom: 6 }}>
                  Round {round.number}
                  {round.resting ? (
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {' '}
                      — {round.resting} sits this one out
                    </span>
                  ) : null}
                </h3>
                <Table
                  cols={[
                    { key: 'n', label: 'Table', className: 'cell-xs' },
                    { key: 'a', label: '', className: 'cell-fill' },
                    { key: 'b', label: '', className: 'cell-fill' },
                  ]}
                  rows={round.pairs.map((p, i) => [
                    <span key="n" className="muted">
                      {i + 1}
                    </span>,
                    p.a,
                    p.b ?? '—',
                  ])}
                />
              </div>
            ))}
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              Table numbers are positions in the room and are stable across rounds, so
              &ldquo;everyone on the left moves one table clockwise&rdquo; is a thing you can say
              over a microphone.
            </p>
          </Panel>
        </>
      )}

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Nothing is saved.</strong> The schedule lives in the URL and is regenerated on
            each load. That is deliberate for now — a stored schedule is a stored roster, and a
            roster implies a sign-up that does not exist.
          </li>
          <li>
            <strong>No app surface.</strong> Attendees cannot see who they are meeting next. That
            is the half Whova has and this does not, and at an in-person session run from a
            microphone it is the smaller half.
          </li>
          <li>
            <strong>No interest-based pairing.</strong>{' '}
            <Link href="/engagement/community/attendee-matchmaking">Attendee Matchmaking</Link>{' '}
            computes shared interests and could seed a first round with them. Round-robin cannot
            honour both constraints — meeting everybody exactly once and meeting your best matches
            first are different orders of the same set.
          </li>
          <li>
            <strong>No timer.</strong> A phone does this well and a dashboard does not.
          </li>
        </ul>
      </Panel>
    </>
  );
}
