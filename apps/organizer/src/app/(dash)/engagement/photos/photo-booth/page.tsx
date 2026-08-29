import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { imageCensus } from '@/lib/images';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Photos › Photo Booth.
 *
 * ── Whova's photo booth is a camera, a frame and a share sheet ─────────────
 *
 * An attendee opens it in the app, takes a picture, it comes back with the
 * event's branding around it, and they post it. Three things this project has
 * none of: no capture (the app has no camera surface), no compositing (nothing
 * draws an overlay onto an image anywhere), and no upload.
 *
 * ── The one that is genuinely hard is the compositing ──────────────────────
 *
 * The camera is a package. The upload is Storage. Drawing a branded frame onto
 * a photo on a phone, at the right size, in the right orientation, without
 * shipping a native image library into an Expo Go build — that is the piece
 * that decides whether this is a week or a month. Saying so is more useful than
 * a size estimate that averages the three.
 *
 * ── What it would use, and what exists of that ─────────────────────────────
 *
 * A frame needs brand assets. `content/branding-center/app-branding` records
 * that the app reads its palette from `constants/theme.ts` at build time — so
 * the branding this booth would apply is currently a TypeScript file, not
 * data. That is the same blocker, one screen upstream.
 */
export default async function PhotoBoothPage() {
  await requireOrganizer();

  const census = await imageCensus();

  return (
    <>
      <PageHeader
        title="Photo Booth"
        tags={<Tag color="grey">No camera, no frame, no upload</Tag>}
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

      <Banner kind="warning">
        <strong>Three pieces are missing and only one of them is hard.</strong> A camera surface in
        the app and an upload path are both packages and plumbing. Compositing a branded frame onto
        a photo on a phone — right size, right orientation, without shipping a native image library
        into an Expo Go build — is the piece that decides whether this is a week or a month.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Photos taken', value: 0, sub: 'no camera surface' },
          { label: 'Frames', value: 0, sub: 'nothing composites' },
          { label: 'Images uploaded', value: census.uploaded, sub: 'nothing writes to Storage' },
          { label: 'Brand assets as data', value: 0, sub: 'palette is a build-time file' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What a photo booth is, in parts</h2>
        <Table
          cols={[
            { key: 'p', label: 'Part', className: 'cell-md' },
            { key: 'w', label: 'What it needs here', className: 'cell-fill' },
            { key: 's', label: 'Difficulty', className: 'cell-sm' },
          ]}
          rows={[
            [
              'Capture',
              <span key="w">
                <code>expo-camera</code> or <code>expo-image-picker</code>. Neither is in the SDK 54
                bundle Expo Go ships, so this needs a development build — which is a decision the
                owner has deferred until after the demo, not a coding problem.
              </span>,
              <Tag key="s" color="blue" small>
                a package
              </Tag>,
            ],
            [
              'The frame',
              'A PNG overlay with a transparent centre, sized per aspect ratio. It is a design asset, and there is nowhere to store one — see App Branding, where the same gap blocks the logo.',
              <Tag key="s" color="orange" small>
                needs Storage
              </Tag>,
            ],
            [
              'Compositing',
              'Drawing the overlay onto the photo, on the device, at full resolution and in the right orientation. React Native has no canvas; the options are a native library (a build), an off-screen WebView canvas (slow and fragile), or doing it on a server (an upload round trip before the attendee sees the result).',
              <Tag key="s" color="red" small>
                the real one
              </Tag>,
            ],
            [
              'Upload',
              'The same Storage write path everything else on this tab waits for.',
              <Tag key="s" color="orange" small>
                blocker 3
              </Tag>,
            ],
            [
              'Sharing',
              'A share sheet is one API call once there is a file to share.',
              <Tag key="s" color="green" small>
                trivial
              </Tag>,
            ],
          ]}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Worth asking before building it</h2>
        <p className="body-2" style={{ marginTop: 0 }}>
          A photo booth earns its keep at a trade show, where a branded selfie is the thing an
          attendee posts and the sponsor pays for. KGC is a research conference of a few hundred
          people who mostly know each other, and the equivalent value is closer to{' '}
          <Link href="/engagement/photos/profile-photo-frames">a profile frame</Link> — one image
          per person, applied once, visible all week — than to a photo wall nobody scrolls.{' '}
          <code>ROADMAP.md</code> puts the trade-show mechanics on the cut list for the same reason,
          and this is the cheapest place to notice that before spending the month.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Nothing at all, and none of it is a dashboard screen.</strong> Every part above
            lives in the app or in Storage. What an organizer would configure here — the frame —
            has nowhere to be stored.
          </li>
          <li>
            <strong>No development build.</strong> The camera needs one, and the project is
            deliberately pinned to Expo Go for the demo. That is a scheduling decision rather than
            a technical gap, and it gates this whether or not anything else is built.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
