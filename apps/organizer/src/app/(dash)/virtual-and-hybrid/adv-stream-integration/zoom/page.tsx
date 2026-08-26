import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Adv. Stream Integration › Zoom.
 *
 * Worth separating two things Whova sells under one word. The *cheap* Zoom
 * integration is a link: paste a meeting URL onto a session and the app opens
 * it. The *advanced* one is an OAuth app against Zoom's API that creates
 * webinars, syncs registrants both ways, and pulls attendance back — and that
 * second one is a Zoom Marketplace app, a review process, and a webhook
 * endpoint that has to be publicly reachable and verified.
 *
 * Neither exists. The distinction matters because the first is genuinely a
 * day's work and the second is not, and quoting the second when someone asks
 * for the first is how a small ask becomes a cut feature.
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
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Connects a Zoom account, creates a meeting or webinar per session, pushes the attendee
          list to Zoom as registrants so each person gets their own join link, and pulls
          attendance back afterwards — who joined, when, for how long. The last part is what
          organizers actually want it for: it is the only reliable attendance record a virtual
          session has.
        </p>

        <h2 className="section-header">The two jobs behind one name</h2>
        <p className="body-2">
          <strong>A link on a session</strong> — a <code>zoomUrl</code> field, rendered as a button
          in the app. No Zoom account access, no API, no review. Roughly a day, and it delivers most
          of what a small event needs.
        </p>
        <p className="body-2">
          <strong>A real integration</strong> — a Zoom Marketplace OAuth app, which means an app
          listing, Zoom&rsquo;s security review, a publicly reachable webhook endpoint with their
          signature verification, token refresh, and per-registrant sync. Weeks, plus an approval
          process that is outside our control, plus a standing obligation to keep it working when
          Zoom changes their API.
        </p>

        <h2 className="section-header">Why neither is queued</h2>
        <p className="body-2">
          KGC is one venue with parallel tracks in physical rooms. The attendance record already
          exists and is better than Zoom&rsquo;s: a badge scan writes an idempotent{' '}
          <code>checkIns</code> document at the door. Adding Zoom would give remote attendance for
          an audience the event does not currently serve — see{' '}
          <Link href="/virtual-and-hybrid/virtual-and-hybrid-setup">Virtual &amp; Hybrid Setup</Link>{' '}
          for the ticket tier that says otherwise.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No Zoom credentials are stored anywhere.</strong> There is no OAuth flow, no
            token store and no <code>ZOOM_*</code> environment variable in any of the three apps.
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
      </Panel>
    </>
  );
}
