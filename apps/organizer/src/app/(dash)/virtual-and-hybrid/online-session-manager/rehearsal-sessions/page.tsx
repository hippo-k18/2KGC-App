import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Online Session Manager › Rehearsal Sessions.
 *
 * Whova books a practice slot in a private version of the streaming room so a
 * speaker can test their microphone, screen share and slides days before they
 * present. It is the highest-value screen in this whole cluster — the failure
 * it prevents is a keynote that starts eight minutes late — and it is also the
 * one that is completely meaningless without the streaming room it rehearses.
 *
 * There is an in-person equivalent worth naming, because it is real work that
 * still has to happen and currently has no home: speaker AV checks in the
 * actual room. That is a task list, and the task list exists.
 */
export default async function RehearsalSessionsPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Rehearsal Sessions"
        links={[
          <Link key="s" href="/virtual-and-hybrid/online-session-manager/streaming-setup">
            Streaming Setup
          </Link>,
          <Link key="m" href={ROUTES.messageSpeakers}>
            Message Speakers
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>Rehearsals rehearse a room that does not exist.</strong> This screen is downstream
        of Streaming Setup in the most literal way — there is no virtual stage to book a slot on.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Opens the session&rsquo;s streaming room early, invisibly to attendees, so the speaker can
          join, check their camera and microphone, share their screen once, and discover that their
          slide deck is on the wrong machine while there is still time to fix it. Organizers see who
          has and has not rehearsed.
        </p>

        <h2 className="section-header">The in-person version of this problem</h2>
        <p className="body-2">
          KGC still needs the same thing without any streaming: every speaker needs five minutes in
          the room with the projector before their track starts, and somebody needs to know which
          ones have had it. That is a checklist with a name per row, and this project already has
          one —{' '}
          <Link href="/content/project-management/projects-and-checklists">
            Projects &amp; Checklists
          </Link>{' '}
          writes real <code>tasks</code> documents with an assignee and a due date.
        </p>
        <p className="body-2">
          Chasing the speakers themselves is{' '}
          <Link href={ROUTES.messageSpeakers}>Message Speakers</Link>, which sends real email and is
          logged per recipient. Between those two the useful half of this screen is already covered
          by things that work.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No rehearsal booking, because there is no room to book.</strong> Building the
            scheduler before the stream would be furniture in an empty lot.
          </li>
          <li>
            <strong>No rehearsed / not-rehearsed status per speaker.</strong> Nothing on{' '}
            <code>SpeakerDoc</code> records readiness, and adding a boolean nothing sets would read
            as a working tracker.
          </li>
          <li>
            <strong>No calendar invitations.</strong> The email sender is real, but it sends
            transactional HTML — there is no <code>.ics</code> generation anywhere in this repo.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
