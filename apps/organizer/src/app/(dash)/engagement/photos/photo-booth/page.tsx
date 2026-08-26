import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { Banner, PageHeader, Panel, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Photos › Photo Booth.
 *
 * Whova's photo booth is a kiosk: a tablet on a stand in the lobby, running a
 * page that takes a picture, stamps the event branding on it, and posts it to
 * the shared album and the social wall.
 *
 * ── It is the union of three unbuilt things ─────────────────────────────────
 *
 * A booth needs somewhere to put the photo (Photo Collection: no collection, no
 * Storage path), branding to stamp on it (Profile Photo Frames: no image
 * pipeline), and somewhere to display it (Social Wall: no public wall, and a
 * consent argument against one). None of the three exists, and a booth is not a
 * fourth feature — it is those three plus a camera and a stand.
 *
 * Which is why this screen is short. Restating the same three arguments a third
 * time would pad it; the useful thing is to say which door each one is behind
 * and point at the screen that makes the case.
 *
 * There is also a hardware answer that is not software: a rented photo booth
 * with an operator does this better, costs less than the engineering, and needs
 * nothing from this dashboard. Worth writing down, because "we could build it"
 * and "we should build it" are different questions and only the second one
 * matters here.
 */
export default async function PhotoBoothPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Photo Booth"
        tags={<Tag color="red" fill="outline">three blockers deep</Tag>}
        links={[
          <Link key="c" href="/engagement/photos/photo-collection">
            Photo collection
          </Link>,
          <Link key="f" href="/engagement/photos/profile-photo-frames">
            Profile photo frames
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>A booth is three unbuilt features plus a tablet.</strong> Somewhere to store the
        photo, branding to stamp on it, and somewhere to show it — none of the three exists, so
        there is nothing here that could be half-built into something useful.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What it depends on</h2>
        <dl className="gap-grid">
          <dt>Storage for the photo</dt>
          <dd>
            No collection, no Storage path, no moderation queue for images. The case is on{' '}
            <Link href="/engagement/photos/photo-collection">Photo Collection</Link>, including the
            part that is staffing rather than code.
          </dd>
          <dt>Branding to stamp on it</dt>
          <dd>
            No image pipeline anywhere in this repo. The case is on{' '}
            <Link href="/engagement/photos/profile-photo-frames">Profile Photo Frames</Link>, and it
            is the same blocker as app branding, sponsor banners and the venue map.
          </dd>
          <dt>Somewhere to display it</dt>
          <dd>
            No public wall. That one is not merely unbuilt —{' '}
            <Link href="/marketing/social-wall/social-wall-customization">
              Social Wall Customization
            </Link>{' '}
            sets out why publishing attendee content is a consent decision rather than a route.
          </dd>
          <dt>The kiosk itself</dt>
          <dd>
            A device left unattended in a lobby, signed in as somebody. Nothing in this project has
            a kiosk mode or a device-scoped credential — the closest is the check-in station, which
            is staffed and holds an organizer session.
          </dd>
        </dl>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>The booth, and all three things under it.</strong> Nothing on this path exists.
          </li>
          <li>
            <strong>Printing.</strong> Whova offers a printed strip. Badge printing is modelled and
            unbuilt in this repo too, so there is no printer path of any kind.
          </li>
          <li>
            <strong>Kiosk mode.</strong> No device-scoped credential, no locked-down screen. An
            unattended tablet signed in as an organizer is a worse problem than a missing feature.
          </li>
          <li>
            <strong>A reason to build it.</strong> A rented booth with an operator does this better
            and costs less than the engineering. Listed as a gap because Whova has the screen, not
            because it is the right thing to build next.
          </li>
        </ul>
      </Panel>
    </>
  );
}
