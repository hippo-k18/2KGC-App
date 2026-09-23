import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes } from '@/lib/commerce';
import { listWatchOverview } from '@/lib/streaming';
import { ROUTES } from '@/lib/nav';
import { EmptyState, NotInputted, PageHeader, Panel, StatTiles, Table } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Documents & Videos › Video Hosting.
 *
 * Video hosting is not a screen; it is a bill and an operational commitment.
 * Storing and transcoding a five-day conference is tens of gigabytes, and
 * serving it behind a paywall needs signed URLs that expire — which needs a
 * trusted server to sign them.
 *
 * The realistic answer is a hosting provider (Mux, Cloudflare Stream, or an
 * unlisted Vimeo) holding the file, with this product holding the link.
 *
 * ⚠️ **That link now exists, as of 2026-09-23.** A recording is attached to its
 * session on Content › Agenda Center › Session Manager, restricted by ticket
 * type, and `firestore.rules` refuses the document to anyone holding the wrong
 * ticket. So this screen counts recordings, which it could not do before, and
 * says plainly what is still true: the file is hosted somewhere else, and
 * uploading one here would need a bucket, a transcode and a signed URL.
 */
export default async function VideoHostingPage() {
  await requireOrganizer();
  const [tickets, watch] = await Promise.all([listTicketTypes(), listWatchOverview()]);
  const entitled = tickets.filter((t) => t.includes.some((i) => /video library/i.test(i)));
  const recorded = watch.filter((r) => r.recording);
  const restricted = recorded.filter((r) => (r.recording?.allowedTicketTypes.length ?? 0) > 0);

  return (
    <>
      <PageHeader
        title="Video Hosting"
        info={
          <>
            <strong>Where the videos live</strong>
            <p>
              The file is hosted wherever you already host video. What is kept here is the link,
              attached to the session it belongs to, and who may watch it.
            </p>
          </>
        }
        links={[
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="ss" href={ROUTES.streamingSetup}>
            Streaming Setup
          </Link>,
          <Link key="a" href="/content/documents-and-videos/attendee-video-access">
            Attendee Video Access
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Recordings', value: recorded.length, sub: `of ${watch.length} sessions` },
          {
            label: 'Restricted by ticket',
            value: restricted.length,
            sub: restricted.length ? 'not everybody can watch' : 'open to every ticket',
          },
          {
            label: 'Tiers that include video',
            value: entitled.length,
            sub: 'sold on the public price list',
          },
        ]}
      />

      <Panel>
        {recorded.length === 0 ? (
          <NotInputted
            what="recordings"
            action={
              <Link className="whova-btn-main primary" href={ROUTES.sessionManager}>
                Attach one to a session
              </Link>
            }
          />
        ) : (
          <Table
            cols={[
              { key: 'title', label: 'Recording', className: 'cell-fill' },
              { key: 'session', label: 'Session', className: 'cell-md' },
              { key: 'length', label: 'Length', className: 'cell-sm' },
              { key: 'who', label: 'Who can watch', className: 'cell-md' },
            ]}
            rows={recorded.map((r) => [
              <Link key="t" href={`${ROUTES.sessionManager}/${r.id}`}>
                {r.recording?.title || r.title}
              </Link>,
              <span key="s" className="muted">
                {r.title}
              </span>,
              <span key="l" className="muted">
                {r.recording?.duration || 'not given'}
              </span>,
              <span key="w">
                {r.recording?.allowedTicketTypes.length
                  ? r.recording.allowedTicketTypes.join(', ')
                  : 'Everybody with a ticket'}
              </span>,
            ])}
            empty={
              <EmptyState>
                <p className="empty-title">No recordings</p>
              </EmptyState>
            }
          />
        )}
      </Panel>

      <Panel>
        <h2 className="section-header">What is not here</h2>
        <p className="body-2">
          You cannot upload a video file. Storing and transcoding a five-day conference is a
          hosting bill, so the file stays with your video provider and this keeps the link.
        </p>
      </Panel>
    </>
  );
}
