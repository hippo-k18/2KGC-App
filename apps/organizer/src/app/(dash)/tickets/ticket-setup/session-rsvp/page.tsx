import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapPanel, PageHeader, Panel } from '../../../ui';

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
        info={
          <>
            <strong>Session RSVP is not available yet</strong>
            <p>
              Attendees can save sessions to their own schedule in the app. Saved sessions are not
              counted or capped.
            </p>
          </>
        }
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

      <Panel>
        <p className="body-2" style={{ margin: 0 }}>
          Session RSVP is not available yet. Set a session&rsquo;s capacity in{' '}
          <Link href="/attendees/session-cap">Session Cap</Link> and choose which tickets admit it
          in <Link href="/attendees/ticket-session-mapping">Ticket Session Mapping</Link>.
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
