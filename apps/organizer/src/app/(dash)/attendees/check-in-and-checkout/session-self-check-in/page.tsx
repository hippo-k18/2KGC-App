import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listCheckInLists } from '@/lib/checkin';
import { listSessions } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, GapTag, NotBuilt, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Check-in & Checkout › Session Self Check-in.
 *
 * Two absent things were stacked on one screen. One of them is now built and
 * the separation is what made that obvious.
 *
 * **Session scope** was the easy half and is done: Check-in's Session card
 * creates a `checkInLists` document per session with a derived id, and the
 * existing scanner writes into it unchanged. The table below is the live
 * evidence — every list that exists, with its scope.
 *
 * **Self** is the hard half and is still refused, for the same reason as the
 * event-door version: `firestore.rules` denies every client write under
 * `checkInLists`, on purpose, so attendance cannot be self-asserted. That is a
 * decision to take rather than a feature to build, and it is sharper here than
 * at the front door — a room-door scan is what an hours claim is computed from,
 * and evidence should not be self-issued.
 */
export default async function SessionSelfCheckInPage() {
  await requireOrganizer();

  // Both reads are a single `where('eventId', '==', …)` with the ordering done
  // in memory. A second field in the query would need a composite index that is
  // not declared, and the emulator does not enforce that — it fails in
  // production, not here.
  const [lists, sessions] = await Promise.all([listCheckInLists(), listSessions()]);
  const sessionLists = lists.filter((l) => l.kind === 'session');

  return (
    <>
      <PageHeader
        title="Session Self Check-in"
        tags={<GapTag />}
        links={[
          <Link key="c" href={ROUTES.checkIn}>
            Attendee Check-in
          </Link>,
          <Link key="s" href="/attendees/check-in-and-checkout/self-check-in">
            Self Check-in
          </Link>,
          <Link key="a" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>Session attendance is recorded by a person, not by the attendee.</strong> A
        staffed room door works — open one from{' '}
        <Link href={ROUTES.checkIn}>Attendee Check-in</Link> and scan badges into it. What this
        screen is named after does not: an attendee cannot scan themselves in, because{' '}
        <code>firestore.rules</code> denies every client write under <code>checkInLists</code>, and
        that refusal is deliberate.
      </Banner>

      <Panel>
        <h2 className="section-header">
          Check-in lists ({lists.length}) · session-scoped ({sessionLists.length})
        </h2>
        <Table
          cols={[
            { key: 'n', label: 'List', className: 'cell-md' },
            { key: 'k', label: 'Scope', className: 'cell-sm' },
            { key: 'i', label: 'Id', className: 'cell-fill' },
          ]}
          empty="No check-in list exists yet"
          rows={lists.map((l) => [
            <strong key="n">{l.name}</strong>,
            <Tag key="k" color={l.kind === 'session' ? 'green' : 'grey'} small>
              {l.kind}
            </Tag>,
            <code key="i" style={{ fontSize: 12 }}>
              {l.id}
            </code>,
          ])}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          {sessions.length} sessions are on the agenda and {sessionLists.length} of them have a
          check-in list. A list appears here the first time somebody presses Start on that session.
        </p>
      </Panel>

      <Panel>
        <h2 className="section-header">Why session scope was the cheap half</h2>
        <p className="body-2">
          <code>CheckInListDoc</code> already carried <code>kind: &lsquo;session&rsquo;</code> and a{' '}
          <code>sessionId</code>, and the check-in document is keyed by registration{' '}
          <em>within a list</em> — so the same attendee can be in a hundred lists without any
          collision, and the idempotency that protects a double scan at the door protects a double
          scan at a room door identically. The list id is derived from the session
          (<code>session-&#123;sessionId&#125;</code>) so that two organizers pressing Start produce
          one door rather than two half-populated ones.
        </p>
        <p className="body-2">
          The <em>self</em> half is the same decision as{' '}
          <Link href="/attendees/check-in-and-checkout/self-check-in">Self Check-in</Link>, with one
          extra edge: room-door scanning is where an unwitnessed check-in is most tempting to fake,
          because it is what a CPE certificate would eventually be computed from. An attendance
          record that is going to be used as evidence should not be self-asserted.
        </p>
      </Panel>

      <NotBuilt
        whova="Attendees check themselves into a session by scanning a code at the room door, with no staff present."
        needs="A trusted-server route that accepts a scan from an unauthenticated client, plus rate limiting and abuse controls on a public endpoint — and first a decision about whether an unwitnessed scan counts as attendance at all. The per-session list it would write into now exists."
        size="~2 days once the decision is made"
        refs="apps/organizer/src/lib/checkin.ts and firestore.rules"
      />

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Self-service scanning.</strong> Denied by the rules, deliberately. See the note
            above — the objection is sharper for a room door than for the front one.
          </li>
          <li>
            <strong>An unattended room device.</strong> Even setting the rules aside, a tablet left
            on a lectern is a session anybody can be counted into by anybody. That is the kiosk
            problem, and it is the same one.
          </li>
          <li>
            <strong>Departures.</strong> A room door counts arrivals. Nothing records who left, so
            the hours computed from these lists are the session&apos;s scheduled length rather than
            time in the seat.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
