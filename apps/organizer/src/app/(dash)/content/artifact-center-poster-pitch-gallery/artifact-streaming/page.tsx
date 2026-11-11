import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { GapPanel, NotInputted, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Artifact Center › Artifact Streaming.
 *
 * Live video from a poster board or a demo table, so a remote attendee can watch
 * somebody explain their work. Two independent blockers, and the second decides
 * it: there are no artifacts, and there is no video infrastructure of any kind
 * in this project.
 *
 * The cheap version worth naming: a link field on the artifact record pointing
 * at whatever meeting room the presenter already has. Worse than a scheduled
 * video room, near-free, and for a poster session whose value is standing in
 * front of the board, close to the right trade. It still needs the artifact
 * record.
 */
export default async function ArtifactStreamingPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Artifact Streaming"
        info={
          <>
            <strong>Not available yet</strong>
            <p>
              Live streams for posters, demos and pitches are not available yet.
            </p>
          </>
        }
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
        <NotInputted what="streamed artifacts" />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
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
      </GapPanel>
    </>
  );
}
