import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Artifact Center › Message Presenters.
 *
 * Blocked once, and it is the collection rather than the send. Message
 * Exhibitors was one edit away and is now real: `AudienceId` in
 * `src/lib/messaging.ts` takes a third value and `resolveExhibitors` resolves
 * it. A fourth value would be the same size of edit — but presenters do not
 * exist, so it would resolve to nobody, which is the shape of defect this
 * codebase already has fourteen recorded instances of.
 *
 * Artifact Manager is where the missing collection is described.
 */
export default async function MessagePresentersPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Message Presenters"
        info={
          <>
            <strong>Nobody to send to yet</strong>
            <p>
              There are no presenters to message yet, because posters, demos and pitches cannot be
              added yet.
            </p>
          </>
        }
        links={[
          <Link key="a" href="/content/artifact-center-poster-pitch-gallery/artifact-manager">
            Artifact Manager
          </Link>,
          <Link key="s" href={ROUTES.messageSpeakers}>
            Message Speakers
          </Link>,
        ]}
      />

      <Panel>
        <NotInputted
          what="presenters"
          action={
            <Link
              className="whova-btn-main primary"
              href="/content/artifact-center-poster-pitch-gallery/artifact-manager"
            >
              Artifact Manager
            </Link>
          }
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Presenters.</strong> No collection, no addresses.
          </li>
          <li>
            <strong>A &ldquo;has not sent their poster&rdquo; segment.</strong> Storage uploads
            work; what is missing is an artifact record with a file field to be missing from.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
