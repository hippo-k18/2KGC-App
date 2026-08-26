import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Adv. Stream Integration › Microsoft Teams.
 *
 * The same shape as the Zoom screen with one difference worth writing down:
 * Teams is harder for a reason that has nothing to do with us. Creating a Teams
 * meeting through Graph requires an application permission
 * (`OnlineMeetings.ReadWrite.All`) that a *tenant administrator* has to grant,
 * and the tenant in question belongs to the attendee's employer, not to KGC.
 * That is a procurement conversation with somebody else's IT department per
 * organisation, which is why event platforms that integrate Zoom in a sprint
 * take much longer over Teams.
 */
export default async function MicrosoftTeamsIntegrationPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Microsoft Teams"
        links={[
          <Link key="z" href="/virtual-and-hybrid/adv-stream-integration/zoom">
            Zoom
          </Link>,
          <Link key="s" href="/virtual-and-hybrid/online-session-manager/streaming-setup">
            Streaming Setup
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Creates Teams meetings or live events for sessions, sends join links to registrants, and
          reports attendance back into the organizer dashboard. In practice most events use it
          because their own staff already live in Teams, not because attendees prefer it.
        </p>

        <h2 className="section-header">The part that is not our decision</h2>
        <p className="body-2">
          Teams meetings are created through Microsoft Graph, and the permission that allows an
          application to create one on a user&rsquo;s behalf is admin-consented at the tenant level.
          KGC would be asking each participating organisation&rsquo;s IT department to grant a
          third-party app that permission in their tenant — a request that is routinely refused, and
          reasonably so. The alternative is delegated consent, which means a human signs in
          interactively for every meeting, which is not an integration.
        </p>
        <p className="body-2">
          So the realistic Teams story for an event our size is the same as the realistic Zoom one:
          a link field on the session, pasted in by whoever created the meeting. That field does not
          exist yet either.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No Microsoft identity of any kind.</strong> No Entra app registration, no Graph
            client, no tenant. Auth in this project is Firebase Auth and nothing else.
          </li>
          <li>
            <strong>No meeting link on a session</strong>, exactly as on the Zoom screen — one
            missing field blocks both of the cheap versions at once.
          </li>
          <li>
            <strong>No attendance import.</strong> Attendance here is a badge scan at a door, and
            that is the record the check-in desk trusts.
          </li>
        </ul>
      </Panel>
    </>
  );
}
