import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { EmptyState, GapPanel, PageHeader, Panel } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Other Tools.
 *
 * Whova's grab-bag: name pronunciation, virtual backgrounds, a session
 * countdown, a lobby video, interpreter channels, live captioning. None of the
 * six exists here, and the useful way to think about them is by what they
 * depend on — because four are downstream of streaming and two are not.
 *
 * **Not stream-dependent, and therefore not really this screen's:**
 * *name pronunciation* is a field plus an audio clip on a speaker profile —
 * storable today, since `lib/uploads.ts` writes to a live bucket, but useless
 * until the app has somewhere to play it; the *session countdown* is a
 * presentation of data the app already computes for the Home tab's now/next.
 * Neither belongs under Virtual & Hybrid at all, which is why neither is built
 * here — putting them on this screen is how a cut cluster grows back one item
 * at a time.
 *
 * **Stream-dependent, and meaningless without one:** virtual backgrounds need a
 * meeting client in the loop; a lobby video needs a remote view to hold;
 * interpretation channels are a second audio track, which in person is hardware
 * and interpreters rather than software.
 *
 * **Live captioning is a budget line, not a screen.** If it is wanted as an
 * accessibility commitment it should be decided for the in-person rooms, where
 * it helps the audience actually attending.
 */
export default async function OtherToolsPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Other Tools"
        links={[
          <Link key="s" href="/virtual-and-hybrid/virtual-and-hybrid-setup">
            Virtual &amp; Hybrid Setup
          </Link>,
          <Link key="r" href={ROUTES.speakerManager}>
            Speaker Manager
          </Link>,
        ]}
      />

      <Panel>
        <EmptyState>
          <p className="empty-title">Not available yet</p>
          <p className="empty-sub">
            Virtual backgrounds, lobby video, interpretation, captions, name pronunciation and a countdown are not available yet.
          </p>
        </EmptyState>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>None of the six exist.</strong> No pronunciation field on{' '}
            <code>SpeakerDoc</code>, no countdown component, no asset library.
          </li>
          <li>
            <strong>The two cheap ones belong elsewhere.</strong> Pronunciation is a field on{' '}
            <code>SpeakerDoc</code> plus an app surface that plays it; the countdown is an app
            concern, not a dashboard one.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
