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
 * Two absent things stacked on one screen, and they are worth separating
 * because only one of them is hard.
 *
 * **Session scope** is easy: a session check-in is another `checkInLists`
 * document with `kind: 'session'` and a `sessionId`, the scanner does not care
 * which list is selected, and the write is the same. What is missing is the UI
 * that creates one per session and picks the right one by the clock.
 *
 * **Self** is not easy, and it is refused for the same reason as the event-door
 * version: `firestore.rules` denies every client write under `checkInLists`, on
 * purpose, so attendance cannot be self-asserted.
 *
 * The table below is the evidence for the first claim — every list that exists,
 * with its scope. All of them are event scope, which is exactly the gap.
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

      <Banner kind="danger">
        <strong>The scanner writes event-door check-ins only.</strong> No session attendance is
        recorded anywhere in this project — not by the desk, not by the app, not by a room monitor.
        Any figure elsewhere that looks like session attendance is a saved-agenda count, which is an
        intention rather than a fact.
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
          check-in list. The model supports the scope; nothing creates the documents.
        </p>
      </Panel>

      <Panel>
        <h2 className="section-header">Why session scope is the cheap half</h2>
        <p className="body-2">
          <code>CheckInListDoc</code> already carries <code>kind: &lsquo;session&rsquo;</code> and a{' '}
          <code>sessionId</code>, and the check-in document is keyed by registration{' '}
          <em>within a list</em> — so the same attendee can be in a hundred lists without any
          collision, and the idempotency that protects a double scan at the door protects a double
          scan at a room door identically. A day or two of UI creates a list per session, selects by
          clock, and the existing scanner writes into it unchanged.
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
        whova="Attendees check themselves into a session by scanning a code at the room door, feeding per-session attendance reports and certificates."
        needs="A per-session check-in list created and selected automatically, plus the same trusted-server write path self check-in would need. The list half is a day or two; the self half is a decision."
        size="1–2 days for session scope, plus ~2 days for a trusted-server self-scan route"
        refs="apps/organizer/src/lib/checkin.ts and firestore.rules"
      />

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Per-session attendance.</strong> Nothing records it. Session-level reporting on
            the Analytics screen is absent for the same reason.
          </li>
          <li>
            <strong>Capacity enforcement at the door.</strong> Session Cap stores a number; nothing
            compares a live headcount against it, because there is no live headcount per room.
          </li>
          <li>
            <strong>Self-service scanning.</strong> Denied by the rules, deliberately. See the note
            above.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
