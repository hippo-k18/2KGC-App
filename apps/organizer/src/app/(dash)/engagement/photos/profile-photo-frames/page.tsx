import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listAttendees } from '@/lib/data';
import { imageCensus } from '@/lib/images';
import { Banner, PageHeader, Panel, ProgressBar, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Photos › Profile Photo Frames.
 *
 * ── The prerequisite is not the frame, it is the photo ─────────────────────
 *
 * A frame is a branded ring drawn around an attendee's profile picture — "I'm
 * speaking at KGC 2027" — and it is genuinely the highest-value thing on this
 * tab for a conference of this size: one image per person, applied once, seen
 * all week.
 *
 * It is also entirely pointless until attendees have profile pictures, and the
 * number below is the point of this screen. `UserDoc.photoURL` exists and
 * nothing in the app sets it: there is no image picker, no upload, and no
 * avatar editor. Whatever the seed wrote is what there is.
 *
 * ── So this counts, rather than offering a frame editor ────────────────────
 *
 * A frame editor over an audience with no photos would configure a ring around
 * nothing. The number of attendees who have a picture at all is the thing that
 * decides whether this feature is worth a fortnight, and it is computable now.
 */
export default async function ProfilePhotoFramesPage() {
  await requireOrganizer();

  const [attendees, census] = await Promise.all([listAttendees(), imageCensus()]);

  const profiles = census.sources.find((s) => s.field === 'users.photoURL');
  const withPhoto = profiles?.withImage ?? 0;
  const signedIn = attendees.filter((a) => a.signedIn).length;

  /**
   * The share of people who have opened the app at all, because a profile photo
   * is only possible for them. Measuring against every ticket holder would
   * understate it and blame the wrong thing.
   */
  const coverage = signedIn > 0 ? withPhoto / signedIn : 0;

  return (
    <>
      <PageHeader
        title="Profile Photo Frames"
        tags={
          withPhoto === 0 ? (
            <Tag color="grey">No photos to frame</Tag>
          ) : (
            <Tag color="orange">{withPhoto} could be framed</Tag>
          )
        }
        links={[
          <Link key="c" href="/engagement/photos/photo-collection">
            Photo Collection
          </Link>,
          <Link key="a" href="/attendees/manage-attendees/attendees">
            Attendees
          </Link>,
          <Link key="b" href="/content/branding-center/app-branding">
            App Branding
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>The blocker is the photo, not the frame.</strong> A ring drawn around a profile
        picture is cheap, and it is the highest-value thing on this tab for a conference of this
        size — one image per person, applied once, visible all week. It is also pointless until
        attendees have pictures, and <strong>nothing in the app sets one</strong>: there is no image
        picker, no upload and no avatar editor. <code>UserDoc.photoURL</code> holds whatever the
        seed or an import put there.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Profiles with a photo', value: withPhoto, sub: `of ${profiles?.total ?? 0}` },
          { label: 'Have opened the app', value: signedIn, sub: `of ${attendees.length} attendees` },
          {
            label: 'Could be framed',
            value: `${Math.round(coverage * 100)}%`,
            sub: 'of people who signed in',
          },
          { label: 'Uploaded here', value: census.uploaded, sub: 'nothing writes to Storage' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>How far a frame would reach</h2>
        <div style={{ marginBottom: 12 }}>
          <ProgressBar pct={Math.round(coverage * 100)} />
        </div>
        <p className="body-2" style={{ marginTop: 0 }}>
          Measured against people who have <em>opened the app</em>, not against every ticket holder
          — a profile photo is only possible for the former, and measuring against the latter would
          understate the number and blame the wrong thing. The people who have not signed in are a{' '}
          <Link href="/tools/app-adoption">separate problem with its own screen</Link>.
        </p>
        <Table
          cols={[
            { key: 'l', label: 'Images of', className: 'cell-md' },
            { key: 'n', label: 'Have one', className: 'cell-sm' },
            { key: 'w', label: 'Who sets it', className: 'cell-fill' },
          ]}
          rows={[
            [
              'Attendee profiles',
              `${withPhoto} / ${profiles?.total ?? 0}`,
              'Nobody. The app has no avatar editor, so this is whatever the seed or an import wrote — which is why the number is what it is rather than what attendees chose.',
            ],
            [
              'Speaker headshots',
              `${census.sources[0]?.withImage ?? 0} / ${census.sources[0]?.total ?? 0}`,
              <span key="w">
                An organizer, on{' '}
                <Link href="/content/speaker-center/speaker-manager">Speaker Manager</Link>, as a
                URL. These are the images a frame would look best on, and they belong to the wrong
                collection for it.
              </span>,
            ],
          ]}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What it would take, honestly ordered</h2>
        <Table
          cols={[
            { key: 'n', label: '', className: 'cell-xs' },
            { key: 's', label: 'Step', className: 'cell-md' },
            { key: 'w', label: '', className: 'cell-fill' },
          ]}
          rows={[
            [
              '1',
              'Let an attendee set a photo at all',
              'An image picker and an upload. Without this the frame has nothing to go around, and everything below is wasted.',
            ],
            [
              '2',
              'A frame asset an organizer can change',
              <span key="w">
                A transparent PNG ring. There is nowhere to store one —{' '}
                <Link href="/content/branding-center/app-branding">App Branding</Link> records that
                the app reads its palette from <code>constants/theme.ts</code> at build time, so
                even the colour of a frame is currently a deploy.
              </span>,
            ],
            [
              '3',
              'Compose it where it is displayed, not on the file',
              'Drawing the ring at render time rather than baking it into the stored image is both cheaper and reversible — the frame comes off after the conference without touching anybody’s photo, which is the behaviour people expect and the opposite of what baking it in gives you.',
            ],
            [
              '4',
              'A share card',
              'The actual point for an attendee: an image they post saying they are coming. That is a server-rendered card rather than an app feature, and it is the piece with marketing value.',
            ],
          ]}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No frame, and nothing to frame.</strong> Both, and the second is upstream of
            the first.
          </li>
          <li>
            <strong>No avatar editor in the app.</strong> The single change that would make this
            screen worth revisiting. It is app work, not dashboard work.
          </li>
          <li>
            <strong>No share card.</strong> The half with marketing value, and the half that needs
            no app at all — a server-rendered image at a public URL, which would also fix the
            missing per-page Open Graph cards that{' '}
            <Link href="/tickets/ticket-marketing/social-sharing">Social Sharing</Link> notes.
          </li>
        </ul>
      </Panel>
    </>
  );
}
