import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Online Session Manager › Streaming Setup.
 *
 * Whova's version is a per-session table: pick a streaming method, paste a link
 * or a stream key, choose whether the recording is kept. There is nothing to
 * put in that table here — `SessionDoc` carries no stream URL, key or provider
 * field, and adding one would be a settings screen for a feed nobody is
 * producing.
 *
 * ── What is actually missing, for whoever costs this ────────────────────────
 *
 * The field on the session document is an afternoon. Everything that makes the
 * field mean something is not, and only the last of these is software:
 *
 *   **A camera and audio rig per room.** KGC runs parallel tracks, so that is
 *   three setups rather than one — and room-mic audio is what remote attendees
 *   complain about, not video.
 *
 *   **An operator per room, for five days.** Somebody has to start it, watch
 *   it, and notice when it stops. The single largest line, and a staffing cost.
 *
 *   **An ingest and delivery provider.** Mux, Cloudflare Stream, Vimeo or a
 *   Zoom webinar, billed per hour ingested and per hour delivered. A five-day
 *   multi-track event is the expensive shape.
 *
 *   **A player in the app.** Expo Go ships a fixed set of native modules, so
 *   the player has to be one of them or the app needs a development build —
 *   AGENTS.md gotcha 1.
 *
 *   **Entitlement at playback.** A stream behind a paid tier needs signed,
 *   expiring URLs, which needs a trusted server to sign them.
 */
export default async function StreamingSetupPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Streaming Setup"
        info={
          <>
            <strong>No provider account, so no stream to configure</strong>
            <p>
              A streaming provider would supply the ingest endpoint and stream key per room, and the
              playback URL the app would open. Until one exists there is nothing to store against a
              session.
            </p>
          </>
        }
        links={[
          <Link key="s" href="/virtual-and-hybrid/virtual-and-hybrid-setup">
            Virtual &amp; Hybrid Setup
          </Link>,
          <Link key="r" href="/virtual-and-hybrid/online-session-manager/rehearsal-sessions">
            Rehearsal Sessions
          </Link>,
        ]}
      />

      <Panel>
        <NotInputted
          what="streams"
          action={
            <Link href={ROUTES.sessionManager} className="whova-btn-main">
              Open Session Manager
            </Link>
          }
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Nothing streams, and no session can be configured to.</strong>{' '}
            <code>SessionDoc</code> carries no stream URL, key or provider field.
          </li>
          <li>
            <strong>No &ldquo;live now&rdquo; state.</strong> The app&rsquo;s Home tab computes
            now/next from session times, which is a clock, not a signal that a feed is up.
          </li>
          <li>
            <strong>The ticket sold against this.</strong> See{' '}
            <Link href="/virtual-and-hybrid/virtual-and-hybrid-setup">Virtual &amp; Hybrid Setup</Link>{' '}
            — the promise is on a live ticket tier and that is the part worth acting on.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
