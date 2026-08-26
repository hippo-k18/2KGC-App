import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSpeakers } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Photos › Profile Photo Frames.
 *
 * Whova generates a branded ring — "I'm speaking at KGC 2027" — that an attendee
 * composites onto their own profile picture and posts on LinkedIn. It is a
 * marketing device wearing a profile-settings hat.
 *
 * ── Two separate things are missing and only one is interesting ─────────────
 *
 * The frame artwork does not exist, because nothing in this repo generates or
 * stores an image. That is the same blocker as the venue map, sponsor banners
 * and app branding, and it is dull.
 *
 * The interesting one: compositing has to happen somewhere, and every option is
 * wrong here. Doing it in the app means a canvas library and a native module
 * Expo Go does not ship. Doing it server-side means this dashboard downloading a
 * stranger's photo from a URL it does not control and re-encoding it. And the
 * output is not a profile photo for our app at all — it is a file the person
 * uploads to LinkedIn, which no artifact this repo produces has ever been.
 *
 * So the honest framing is that this is a marketing asset, and the marketing
 * asset screens already say the same thing about images. The count below is the
 * one fact worth having: how many speakers even have a photo to frame.
 */
export default async function ProfilePhotoFramesPage() {
  await requireOrganizer();
  const speakers = await listSpeakers();

  const withPhoto = speakers.filter((s) => s.hasPhoto).length;

  return (
    <>
      <PageHeader
        title="Profile Photo Frames"
        tags={<Tag color="red" fill="outline">no image pipeline</Tag>}
        links={[
          <Link key="c" href="/engagement/photos/photo-collection">
            Photo collection
          </Link>,
          <Link key="g" href="/tools/app-adoption/downloadable-graphics">
            Downloadable graphics
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>Nothing here makes an image.</strong> There is no frame artwork, no compositing and
        no download. The people this is aimed at are speakers posting &ldquo;I&rsquo;m speaking
        at&rdquo; on LinkedIn — {withPhoto} of {speakers.length} of them have a photo on file at all,
        which is the ceiling on how many a frame could ever reach.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Speakers', value: speakers.length, sub: 'the intended audience' },
          {
            label: 'With a photo',
            value: withPhoto,
            sub: speakers.length - withPhoto > 0 ? `${speakers.length - withPhoto} without` : 'all of them',
          },
          { label: 'Frames', value: 0, sub: 'no artwork exists' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where the compositing would have to happen</h2>
        <dl className="gap-grid">
          <dt>In the app</dt>
          <dd>
            A canvas or image-manipulation library, which on React Native means a native module.
            Expo Go ships a fixed set and does not include one, so this alone would force the move
            to development builds.
          </dd>
          <dt>In this dashboard</dt>
          <dd>
            Server-side compositing means fetching a person&rsquo;s photo from a URL we do not
            control, decoding it, and re-encoding it. That is an image pipeline and a fetch of
            arbitrary remote content, neither of which exists here.
          </dd>
          <dt>Neither, really</dt>
          <dd>
            The output is a file somebody uploads to LinkedIn. Nothing in this repo produces a file
            for a person to download — every &ldquo;asset&rdquo; on the App Adoption screens is text
            or a snippet, for exactly this reason.
          </dd>
        </dl>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Frame artwork.</strong> Would come from App Branding, which is itself unbuilt
            because it needs the same Storage upload path.
          </li>
          <li>
            <strong>Compositing and download.</strong> See above — every placement for it is wrong
            given the current stack.
          </li>
          <li>
            <strong>Changing an attendee&rsquo;s profile photo from here.</strong>{' '}
            <code>UserDoc.photoURL</code> is the attendee&rsquo;s own, and this dashboard does not
            edit personal profiles. Chasing a missing speaker headshot is{' '}
            <Link href={ROUTES.messageSpeakers}>Message Speakers</Link>, which does work.
          </li>
          <li>
            <strong>Tracking who used a frame.</strong> Whova counts it. There would be nothing to
            count, and nothing measures the public site anyway.
          </li>
        </ul>
      </Panel>
    </>
  );
}
