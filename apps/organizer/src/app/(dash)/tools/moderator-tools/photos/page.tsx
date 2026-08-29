import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel } from '../../../ui';

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
 * avatar URL, and nothing in the app uploads a file at all.
 *
 * So the honest content of this screen is the *ordering* — what has to exist
 * before a moderation queue means anything — because building the queue first
 * is how you end up with an empty table that implies photos are being watched.
 */
export default async function ModeratePhotosPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Photos"
        links={[
          <Link key="b" href={ROUTES.moderateBoard}>
            Community Board
          </Link>,
          <Link key="q" href="/tools/moderator-tools/moderate-session-qanda">
            Moderate Session Q&amp;A
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>Nothing to moderate: attendees cannot post photos.</strong> There is no photo wall,
        no photo booth and no image upload anywhere in the app. An empty queue here would suggest
        somebody is watching a stream of pictures that does not exist.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What would have to come first</h2>
        <ol className="body-2" style={{ paddingLeft: 18, lineHeight: 1.8 }}>
          <li>
            <strong>An upload path.</strong> <code>storage.rules</code> exists and no screen in this
            project uploads a file — that is roadmap blocker 3, and it gates roughly eighteen
            screens, not just this one.
          </li>
          <li>
            <strong>An image pipeline.</strong> A phone photo is several megabytes; serving it to a
            thousand devices unresized is a bandwidth bill and a slow feed. Resizing needs somewhere
            server-side to run.
          </li>
          <li>
            <strong>A publishing model.</strong> Pre-moderated (nothing appears until approved) or
            post-moderated (everything appears, complaints pull it). That choice determines whether
            this screen is a queue or an inbox, and it is a policy question about a room of a
            thousand people with cameras.
          </li>
          <li>
            <strong>Then this screen.</strong> A list, a hide action, and an audit entry per
            decision — which is the small part.
          </li>
        </ol>
        <p className="body-2">
          There is one thing worth noticing about the order: the photo feature is the cheap half and
          the moderation obligation is the expensive half. A conference that turns on a public photo
          wall has committed somebody to watching it for five days.
        </p>
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
          <li>
            <strong>Moderation that does exist:</strong> the community board (
            <Link href={ROUTES.moderateBoard}>Community Board</Link>) and session Q&amp;A (
            <Link href={ROUTES.qaManager}>Session Q&amp;A Manager</Link>), both over text that
            attendees really can post.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
