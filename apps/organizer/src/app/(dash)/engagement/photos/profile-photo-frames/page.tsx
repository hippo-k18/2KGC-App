import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listAttendees } from '@/lib/data';
import { imageCensus } from '@/lib/images';
import { GapPanel, NotInputted, PageHeader, Panel, ProgressBar, StatTiles, Table, Tag } from '../../../ui';

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
        info={
          <>
            <strong>Frames are not available yet</strong>
            <p>
              Attendees cannot set a profile photo in the app yet. This screen shows how many
              profiles already have a photo a frame could go on.
            </p>
          </>
        }
        tags={
          withPhoto === 0 ? null : <Tag color="orange">{withPhoto} could be framed</Tag>
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

      <StatTiles
        tiles={[
          { label: 'Profiles with a photo', value: withPhoto, sub: `of ${profiles?.total ?? 0}` },
          { label: 'Have opened the app', value: signedIn, sub: `of ${attendees.length} attendees` },
          {
            label: 'Could be framed',
            value: `${Math.round(coverage * 100)}%`,
            sub: 'of people who signed in',
          },
          { label: 'Frames', value: 0 },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>How far a frame would reach</h2>
        <div style={{ marginBottom: 12 }}>
          <ProgressBar pct={Math.round(coverage * 100)} />
        </div>
        <p className="body-2" style={{ marginTop: 0 }}>
          Counted against people who have opened the app. For people who have not signed in yet,
          see <Link href="/tools/app-adoption">App Adoption</Link>.
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
              'Nobody yet. Attendees cannot change their photo in the app.',
            ],
            [
              'Speaker headshots',
              `${census.sources[0]?.withImage ?? 0} / ${census.sources[0]?.total ?? 0}`,
              <span key="w">
                An organizer, on{' '}
                <Link href="/content/speaker-center/speaker-manager">Speaker Manager</Link>.
              </span>,
            ],
          ]}
          empty={<NotInputted what="profile photos" />}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
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
      </GapPanel>
    </>
  );
}
