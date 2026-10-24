import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { imageCensus } from '@/lib/images';
import { EmptyState, GapPanel, PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Photos › Photo Booth.
 *
 * An attendee opens it in the app, takes a picture, it comes back with the
 * event's branding around it, and they post it.
 *
 * ── Three pieces missing, and only one of them is interesting ──────────────
 *
 * The camera is a package (`expo-camera`, which needs a development build
 * rather than Expo Go). The upload is solved: the Storage bucket exists and
 * `lib/uploads.ts` writes to it from three screens (`OWNER-ACTIONS.md` §1, done
 * 2026-09-01) — though that path takes a file out of a Server Action's
 * FormData, and a phone would need an equivalent of its own.
 *
 * The one that decides the size of the job is the compositing: drawing a
 * branded frame onto a photo on the device, at full resolution and in the right
 * orientation. React Native has no canvas, so the options are a native library
 * (a build), an off-screen WebView (slow and fragile), or a server round trip
 * before the attendee sees their own picture.
 *
 * ── And it may be the wrong feature for this conference ─────────────────────
 *
 * A photo booth earns its keep at a trade show, where a branded selfie is what
 * the sponsor pays for. For a research conference of a few hundred people the
 * equivalent value is a profile frame — one image per person, applied once,
 * visible all week. That is the neighbouring screen, and it is the cheaper bet.
 */
export default async function PhotoBoothPage() {
  await requireOrganizer();

  const census = await imageCensus();

  return (
    <>
      <PageHeader
        title="Photo Booth"
        info={
          <>
            <strong>Not available yet</strong>
            <p>Attendees cannot take framed photos in the app yet.</p>
          </>
        }
        links={[
          <Link key="c" href="/engagement/photos/photo-collection">
            Photo Collection
          </Link>,
          <Link key="f" href="/engagement/photos/profile-photo-frames">
            Profile Photo Frames
          </Link>,
          <Link key="b" href="/content/branding-center/app-branding">
            App Branding
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Photos taken', value: 0 },
          { label: 'Frames', value: 0 },
          { label: 'Images uploaded', value: census.uploaded, sub: 'across the whole event' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Booth photos</h2>
        <EmptyState>
          <p className="empty-title">No booth photos yet</p>
          <p className="empty-sub">The photo booth is not available in the app yet.</p>
        </EmptyState>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Nothing at all, and almost none of it is a dashboard screen.</strong> Capture
            and compositing live in the app. What an organizer would configure here (the frame)
            has nowhere to be stored.
          </li>
          <li>
            <strong>No development build.</strong> The camera needs one, and the project is pinned
            to Expo Go. That is a scheduling decision rather than a technical gap, and it gates this
            whether or not anything else is built.
          </li>
          <li>
            <strong>Worth asking whether to build it at all.</strong> The profile frame next door is
            the cheaper bet for a conference this size — see the header of this file.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
