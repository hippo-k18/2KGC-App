import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Artifact Center › Artifact Streaming.
 *
 * Live video from a poster board or a demo table, so a remote attendee can watch
 * somebody explain their work. Two independent blockers, and the second is the
 * one that decides it: there are no artifacts, and there is no video
 * infrastructure of any kind in this project.
 */
export default async function ArtifactStreamingPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Artifact Streaming"
        links={[
          <Link key="a" href="/content/artifact-center-poster-pitch-gallery/artifact-manager">
            Artifact Manager
          </Link>,
          <Link key="v" href="/content/documents-and-videos/video-hosting">
            Video Hosting
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Gives each poster or demo a scheduled live slot with a video room, so remote attendees can
          drop in on a presenter at their board. In practice it is a Zoom link per artifact with a
          timetable around it.
        </p>

        <h2 className="section-header">What this would need</h2>
        <p className="body-2">
          The artifact model first — <strong>6–8 days</strong>, sized on Artifact Manager. Then
          video, which is not a screen but a bill: a provider, a room per artifact, an access rule
          tying a room to a ticket, and signed URLs that expire, which needs a trusted server to
          sign them. Video Hosting sets out that argument in full and reaches the same conclusion:
          the realistic answer is a hosting provider with this screen holding ids, not anything we
          run.
        </p>
        <p className="body-2">
          The cheap version that is worth naming: a link field on the artifact record, pointing at
          whatever meeting room the presenter already has. Worse than Whova, near-free, and for a
          poster session where the value is standing in front of the board, close to the right
          trade.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Artifacts.</strong> No collection.
          </li>
          <li>
            <strong>Video, anywhere.</strong> No streaming, no hosting, no recording, no player. The
            entitlement is modelled — <code>TicketTypeDoc.includesVideoLibrary</code> is set on two
            tiers and is genuinely sold — and nothing serves it.
          </li>
          <li>
            <strong>Scheduled slots.</strong> Sessions have times; artifacts have no records to
            attach a time to.
          </li>
        </ul>
      </Panel>
    </>
  );
}
