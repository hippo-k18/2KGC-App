import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { EmptyState, GapPanel, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tools › Moderator Tools › Photos.
 *
 * ── There is no queue because there is no camera ────────────────────────────
 *
 * Moderation screens are downstream of the feature they moderate. Whova has a
 * photo wall, a photo booth and profile frames, so it needs somewhere to take
 * an inappropriate picture down quickly. This app has none of the three: the
 * only image in the whole data model is `photoURL` on a profile, which is an
 * avatar URL, and nothing in the *attendee app* uploads a file at all.
 *
 * ⚠️ That is a statement about the app, not about storage. Firebase Storage is
 * live and `apps/organizer/src/lib/uploads.ts` is a working writer — the
 * dashboard has uploaded exhibitor, sponsor and speaker images since
 * 2026-09-01. What is missing is a camera surface in the phone app and a
 * publishing policy for what it produces, not a bucket.
 *
 * So the screen renders the empty state rather than a table, and sends the
 * moderator to the two queues that are real. The one thing worth remembering
 * about the ordering: the photo feature is the cheap half and the moderation
 * obligation is the expensive half. A conference that turns on a public photo
 * wall has committed somebody to watching it for five days.
 */
export default async function ModeratePhotosPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Photos"
        info={
          <>
            <strong>Attendees cannot post photos</strong>
            <p>The attendee app has no photo sharing yet, so there is nothing to moderate.</p>
          </>
        }
        links={[
          <Link key="b" href={ROUTES.moderateBoard}>
            Community Board
          </Link>,
          <Link key="q" href="/tools/moderator-tools/moderate-session-qanda">
            Moderate Session Q&amp;A
          </Link>,
        ]}
      />

      <Panel>
        <EmptyState
          action={
            <Link href={ROUTES.moderateBoard} className="whova-btn-main secondary">
              Moderate the community board
            </Link>
          }
        >
          <p className="empty-title">Photo sharing is not available yet</p>
        </EmptyState>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No photo queue, no hide action, no reports.</strong> Nothing writes an image
            document, so there is no collection to read.
          </li>
          <li>
            <strong>Profile avatars are not moderated either.</strong> <code>photoURL</code> is a URL
            on a user document and no screen reviews it; it is set from the sign-in provider rather
            than uploaded.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
