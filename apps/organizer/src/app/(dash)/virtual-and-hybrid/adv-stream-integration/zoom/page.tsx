import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { EmptyState, GapPanel, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Adv. Stream Integration › Zoom.
 *
 * ── Two jobs sold under one word, and the distinction is the useful part ────
 *
 * The *cheap* Zoom integration is a link: a `zoomUrl` field on a session,
 * rendered as a button in the app. No Zoom account access, no API, no review;
 * roughly a day, and it delivers most of what a small event needs.
 *
 * The *advanced* one — the one this nav node is named after — is a Zoom
 * Marketplace OAuth app: an app listing, Zoom's security review, a publicly
 * reachable webhook endpoint with their signature verification, token refresh,
 * and per-registrant sync. Weeks, plus an approval process outside our control,
 * plus a standing obligation when Zoom changes their API.
 *
 * Neither exists. Quoting the second when somebody asks for the first is how a
 * small ask becomes a cut feature, which is why that is written down here
 * rather than on the screen: it is a note for whoever costs the work, not
 * something an organizer needs to read on the way to a control.
 *
 * The attendance argument is worth keeping too. KGC is one venue with parallel
 * tracks in physical rooms, and the attendance record already exists and is
 * better than Zoom's: a badge scan writes an idempotent `checkIns` document at
 * the door.
 */
export default async function ZoomIntegrationPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Zoom"
        links={[
          <Link key="t" href="/virtual-and-hybrid/adv-stream-integration/microsoft-teams">
            Microsoft Teams
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
            Zoom is not available yet. Attendance is recorded by badge scan at check-in.
          </p>
        </EmptyState>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No Zoom credentials are stored anywhere.</strong> No OAuth flow, no token store
            and no <code>ZOOM_*</code> environment variable in any of the three apps.
          </li>
          <li>
            <strong>No meeting link on a session.</strong> Even the cheap version has nowhere to
            live — <code>SessionDoc</code> has no URL field of any kind.
          </li>
          <li>
            <strong>No webhook endpoint.</strong> <code>apps/web</code> hosts one webhook route, for
            Stripe. A Zoom app would need a second, with Zoom&rsquo;s own signature scheme.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
