import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, Table } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › Session RSVP.
 *
 * ── The distinction this screen exists to keep straight ─────────────────────
 *
 * The app already has "add to my schedule": `users/{uid}/savedSessions`, a
 * uid-keyed subcollection the attendee writes themselves. It looks like an RSVP
 * and is not one, in the way that matters — it is a private bookmark. Nobody is
 * turned away for not having it, nothing is capped by it, and an organizer
 * cannot even count it without a collection-group query across every attendee.
 *
 * An RSVP is a promise the event can act on: counted against a capacity,
 * closed when full, and checkable at the door. Treating the bookmark count as
 * an RSVP count is the specific mistake to avoid here, because the number looks
 * plausible and systematically overstates attendance — people save four
 * parallel sessions and attend one.
 */
export default async function SessionRsvpPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Session RSVP"
        links={[
          <Link key="c" href="/attendees/session-cap">
            Session Cap
          </Link>,
          <Link key="m" href="/attendees/ticket-session-mapping">
            Ticket Session Mapping
          </Link>,
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>Saving a session is not RSVPing to it.</strong> The app&rsquo;s schedule feature
        writes a private bookmark. Nothing counts it, caps it or checks it, and the count would
        overstate attendance anyway — attendees save several parallel sessions and go to one.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The four parts of an RSVP, and what exists</h2>
        <Table
          cols={[
            { key: 'p', label: 'Part', className: 'cell-md' },
            { key: 's', label: 'Today', className: 'cell-fill' },
          ]}
          rows={[
            [
              'A capacity',
              <span key="s">
                Exists. <code>SessionDoc.capacity</code> is a real number and{' '}
                <Link href="/attendees/session-cap">Session Cap</Link> compares it against the
                room&rsquo;s seats.
              </span>,
            ],
            [
              'Eligibility',
              <span key="s">
                Partly. <code>includesWorkshops</code> decides who may attend a workshop, which{' '}
                <Link href="/attendees/ticket-session-mapping">Ticket Session Mapping</Link>{' '}
                derives from the entitlement rather than guessing from prose.
              </span>,
            ],
            [
              'A booking that is counted',
              <span key="s" className="muted">
                Missing. There is no per-session registration document, so there is nothing to
                count and nothing to close when it fills.
              </span>,
            ],
            [
              'A check at the door',
              <span key="s" className="muted">
                Missing. Check-in is per event, not per session — one{' '}
                <code>checkIns</code> document against a list, not against a talk.
              </span>,
            ],
          ]}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Why the missing half is more than a form</h2>
        <p className="body-2">
          A capped RSVP is a concurrency problem before it is a UI problem: two people taking the
          last workshop seat at the same moment must not both get it. Firestore&rsquo;s answer is a
          transaction on the session document, which serialises writes to one document — fine for a
          40-seat workshop, and a well-known contention limit if a keynote-sized session ever used
          it. The uid-keyed subcollection pattern this project uses for reactions and votes exists
          for exactly that reason, and it does not give a count without a Cloud Function trigger,
          which the Spark plan does not allow.
        </p>
        <p className="body-2">
          So the honest sequence is: capacity first (done), waitlist behaviour decided second, and
          the trigger third — after the Blaze decision, not before it.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No RSVP, no waitlist, no cancellation.</strong> Nothing writes a per-session
            booking, so there is no list to show and no capacity to enforce.
          </li>
          <li>
            <strong>No session-level check-in.</strong> Modelled as{' '}
            <code>Session Self Check-in</code> in the nav and unbuilt; the badge scan is an event
            door, not a room door.
          </li>
          <li>
            <strong>Bookmark counts are not shown anywhere</strong>, deliberately. A number labelled
            &ldquo;interested&rdquo; becomes a number somebody orders catering from.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
