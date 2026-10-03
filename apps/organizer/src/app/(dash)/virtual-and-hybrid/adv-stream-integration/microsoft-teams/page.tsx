import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { EmptyState, GapPanel, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Adv. Stream Integration › Microsoft Teams.
 *
 * The same shape as the Zoom screen with one difference worth writing down,
 * because it changes what "not built" means here.
 *
 * Teams meetings are created through Microsoft Graph, and the permission that
 * lets an application create one on a user's behalf — `OnlineMeetings.ReadWrite.All`
 * — is admin-consented at the *tenant* level. The tenant belongs to the
 * attendee's employer, not to KGC. So this is not a matter of us doing the
 * work: it is a procurement conversation with somebody else's IT department,
 * per organisation, and it is routinely refused for good reason. The
 * alternative, delegated consent, means a human signs in interactively for
 * every meeting, which is not an integration.
 *
 * The realistic Teams story for an event this size is therefore the same as the
 * realistic Zoom one: a link field on the session, pasted in by whoever created
 * the meeting. That field does not exist either.
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
        <EmptyState>
          <p className="empty-title">Not available yet</p>
          <p className="empty-sub">
            Microsoft Teams is not available yet. Attendance is recorded by badge scan at check-in.
          </p>
        </EmptyState>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
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
      </GapPanel>
    </>
  );
}
