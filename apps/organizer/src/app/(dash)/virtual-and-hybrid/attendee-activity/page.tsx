import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { PageHeader, Panel, Table } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Attendee Activity.
 *
 * Whova's per-attendee activity feed: which sessions someone watched, for how
 * long, what they clicked, when they were last in the app. Sponsors want it and
 * organizers use it to spot the delegates who have gone quiet.
 *
 * The reason this is not a small screen is that it is a *different kind of
 * data* from everything else in this project. Firestore documents record state
 * — a registration, an order, a check-in. An activity feed records events, and
 * nothing here emits events. There is no analytics collection, no client SDK
 * reporting screen views, and deliberately no third-party tracker in an app
 * whose users are named individuals holding a badge.
 */
export default async function AttendeeActivityPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Attendee Activity"
        links={[
          <Link key="a" href={ROUTES.analyticsExports}>
            Analytics &amp; Exports
          </Link>,
          <Link key="at" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="c" href={ROUTES.checkIn}>
            Check-in
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What can be said about an attendee today</h2>
        <p className="body-2">
          Not nothing — but all of it is state somebody wrote on purpose, not behaviour observed in
          the background. That distinction is the whole gap:
        </p>
        <Table
          cols={[
            { key: 'k', label: 'Signal', className: 'cell-md' },
            { key: 'w', label: 'Where it comes from', className: 'cell-fill' },
          ]}
          rows={[
            ['Bought a ticket', <span key="w">An <code>orders</code> document written by the Stripe webhook.</span>],
            ['Claimed their account', <span key="w">The registration&rsquo;s <code>claimedByUid</code>, set when they sign in.</span>],
            ['Turned up', <span key="w">A <code>checkIns</code> document written by a badge scan at the desk.</span>],
            ['Built a schedule', <span key="w"><code>users/{'{uid}'}/savedSessions</code>, written by the attendee themselves.</span>],
            ['Posted or replied', <span key="w"><code>communityPosts</code> and its <code>replies</code> subcollection.</span>],
            ['Asked a question', <span key="w"><code>sessions/{'{id}'}/questions</code>, visible in the Q&amp;A manager.</span>],
          ]}
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          <Link href={ROUTES.analyticsExports}>Analytics &amp; Exports</Link> already aggregates the
          first four of those across the whole event.
        </p>

        <h2 className="section-header">What is missing, and why it stays missing</h2>
        <p className="body-2">
          Whova&rsquo;s feed is built on session-view events with durations, which only exist when
          the app streams the session. Adding a general-purpose event log to get the rest — screens
          opened, profiles viewed, time in app — would mean a new high-write collection and a
          tracker inside an app used by identifiable people at a conference. That is a privacy
          decision, not a feature, and it should be made deliberately rather than arrived at by
          building the screen.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No per-attendee timeline.</strong> The signals above live in six collections
            with no join key an organizer could scan visually, and stitching them per person is a
            query fan-out per row.
          </li>
          <li>
            <strong>No last-seen, no time-in-app, no screen views.</strong> Nothing writes them and
            no analytics SDK is installed in the app.
          </li>
          <li>
            <strong>No session dwell time.</strong> It needs either a stream or a scan on the way
            out, and <code>Checkout</code> — the leaving-the-building half of check-in — is
            modelled and unbuilt.
          </li>
        </ul>
      </Panel>
    </>
  );
}
