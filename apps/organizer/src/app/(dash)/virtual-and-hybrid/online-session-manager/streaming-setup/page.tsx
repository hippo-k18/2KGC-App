import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { PageHeader, Panel, Table } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Online Session Manager › Streaming Setup.
 *
 * Whova's version is a per-session table: pick a streaming method, paste a
 * link or a stream key, choose whether the recording is kept. It looks like a
 * settings screen and is really the front end of an AV operation.
 *
 * The costs below are the reason `ROADMAP.md` puts this cluster in the cut
 * column rather than the backlog. They are not engineering estimates; the
 * engineering is the small half.
 */
export default async function StreamingSetupPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Streaming Setup"
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
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Gives every session a streaming method — Whova&rsquo;s own simple-live streaming, an
          embedded RTMP feed, or a third-party meeting link — and stores the key or URL against the
          session so the app can open the right thing at the right time. Recording, replay and the
          &ldquo;live now&rdquo; badge all hang off that one field.
        </p>

        <h2 className="section-header">What it would actually cost</h2>
        <p className="body-2">
          The field on the session document is an afternoon. Everything that makes the field mean
          something is not:
        </p>
        <Table
          cols={[
            { key: 'p', label: 'Part', className: 'cell-md' },
            { key: 'w', label: 'What it involves', className: 'cell-fill' },
          ]}
          rows={[
            [
              'A camera per room',
              'KGC runs parallel tracks. Streaming three rooms means three camera-and-audio setups, not one — and audio from a room mic is the part attendees complain about, not video.',
            ],
            [
              'An operator per room',
              'Five days. Somebody has to start it, watch it, and notice when it stops. This is the single largest line and it is a staffing cost, not a software one.',
            ],
            [
              'An ingest and delivery provider',
              'Mux, Cloudflare Stream, Vimeo or a Zoom webinar. Billed per hour ingested and per hour delivered; a five-day multi-track event is the expensive shape.',
            ],
            [
              'A player in the app',
              'Expo Go ships a fixed set of native modules, so the player has to be one of them or the app needs a development build — see AGENTS.md gotcha 1.',
            ],
            [
              'Entitlement at playback',
              'A stream behind a paid tier needs signed, expiring URLs, which needs a trusted server to sign them. The same problem Video Hosting records.',
            ],
          ]}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Nothing streams, and no session can be configured to.</strong>{' '}
            <code>SessionDoc</code> carries no stream URL, key or provider field, so there is not
            even a place to record an intention.
          </li>
          <li>
            <strong>No &ldquo;live now&rdquo; state.</strong> The app&rsquo;s Home tab computes
            now/next from session times, which is a clock, not a signal that a feed is actually up.
          </li>
          <li>
            <strong>The ticket that was sold against this.</strong> See{' '}
            <Link href="/virtual-and-hybrid/virtual-and-hybrid-setup">Virtual &amp; Hybrid Setup</Link>{' '}
            — the promise is on a live ticket tier and that is the part worth acting on.
          </li>
        </ul>
      </Panel>
    </>
  );
}
