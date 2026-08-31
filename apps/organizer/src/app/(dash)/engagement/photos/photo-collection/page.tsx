import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { imageCensus } from '@/lib/images';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Photos › Photo Collection.
 *
 * ── The blocker is not the gallery, it is that nothing uploads ─────────────
 *
 * Whova's photo wall is attendees posting pictures during the event. Building
 * the wall first is not the missing half: **nothing anywhere in this project
 * uploads a file**. Every image it holds is a URL somebody typed or an importer
 * copied, `storage.rules` exists with nothing writing through it, and the app
 * has no image picker.
 *
 * So the useful content of this screen is the census — what images actually
 * exist, and where they are served from. That turns "photos are not built"
 * from a claim into a fact an organizer can plan around, and it surfaces a
 * second problem they did not know they had: a speaker grid of hotlinked
 * headshots breaks when somebody's blog moves.
 *
 * ── Building the queue first is the specific mistake to avoid ──────────────
 *
 * `tools/moderator-tools/photos` makes the same argument from the other end: a
 * moderation screen for a feature that does not exist is an empty table
 * implying photos are being watched. This screen would be the same lie in
 * gallery form.
 */
export default async function PhotoCollectionPage() {
  await requireOrganizer();

  const census = await imageCensus();

  return (
    <>
      <PageHeader
        title="Photo Collection"
        tags={<Tag color="grey">No uploads anywhere</Tag>}
        links={[
          <Link key="m" href={ROUTES.moderateBoard}>
            Moderate the board
          </Link>,
          <Link key="p" href="/tools/moderator-tools/photos">
            Moderate photos
          </Link>,
          <Link key="s" href="/content/speaker-center/speaker-manager">
            Speakers
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>Nothing in this project uploads a file — that is the blocker, not the gallery.</strong>{' '}
        All {census.totalImages} images it holds are URLs somebody typed or an importer copied;{' '}
        {census.uploaded} were uploaded here. <code>storage.rules</code> exists and nothing writes
        through it, and the app has no image picker. A photo wall built on top of that would be an
        empty grid implying attendees can post.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Images held', value: census.totalImages, sub: 'across three collections' },
          { label: 'Uploaded here', value: census.uploaded, sub: 'nothing writes to Storage' },
          { label: 'On other people’s servers', value: census.offsite, sub: 'breaks when they move' },
          { label: 'Attendee photos', value: census.sources[2]?.withImage ?? 0, sub: `of ${census.sources[2]?.total ?? 0} profiles` },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Every image, and who serves it</h2>
        <Table
          cols={[
            { key: 'l', label: 'Images of', className: 'cell-md' },
            { key: 'n', label: 'Have one', className: 'cell-sm' },
            { key: 'h', label: 'Served from', className: 'cell-fill' },
            { key: 'e', label: 'Edited at', className: 'cell-md' },
          ]}
          rows={census.sources.map((s) => [
            <div key="l">
              <div>{s.label}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                <code>{s.field}</code>
              </div>
            </div>,
            <span key="n">
              {s.withImage}
              <span className="muted"> / {s.total}</span>
            </span>,
            <span key="h" style={{ fontSize: 12 }}>
              {s.hosts.length === 0 ? (
                <span className="muted">none</span>
              ) : (
                s.hosts.map((h) => `${h.host} (${h.count})`).join(' · ')
              )}
            </span>,
            s.editedAt ? (
              <Link key="e" href={s.editedAt} style={{ fontSize: 12 }}>
                open
              </Link>
            ) : (
              <span key="e" className="muted" style={{ fontSize: 12 }}>
                {s.editedNote ?? 'nowhere'}
              </span>
            ),
          ])}
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          ⚠️ An image on a domain KGC does not control disappears when that domain does. For a
          speaker grid on a public page, the failure is visible and permanent, and it happens
          months after anybody was looking.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What has to exist first, in order</h2>
        <Table
          cols={[
            { key: 'n', label: '', className: 'cell-xs' },
            { key: 's', label: 'Step', className: 'cell-md' },
            { key: 'w', label: '', className: 'cell-fill' },
          ]}
          rows={[
            [
              '1',
              'A write path to Storage',
              'A signed-upload route or a rule letting an authenticated attendee write one object under their own uid. `storage.rules` exists and has never been deployed, which is a separate and smaller problem.',
            ],
            [
              '2',
              'A size and type check that runs on the server',
              'A client-side check is a suggestion. Without a server one, the first person to upload a 40 MB HEIC finds out for everybody.',
            ],
            [
              '3',
              'A resize pipeline',
              'A phone photo is four thousand pixels wide. Serving that to a grid is a bill and a slow app. Resizing needs a function, which needs Blaze — this is the step that turns a fortnight into a plan.',
            ],
            [
              '4',
              'A picker in the app',
              '`expo-image-picker` is not in the SDK 54 bundle Expo Go ships, so this also needs a development build. Worth knowing before it is promised.',
            ],
            [
              '5',
              'Then the wall, and only then the queue',
              'The gallery and the moderation queue are the easy end and are last on purpose — building either first produces a screen that implies the other four exist.',
            ],
          ]}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No photo wall, and no upload.</strong> Both, and in that order — the wall is
            downstream of the upload, and the upload is downstream of Storage being wired at all.
          </li>
          <li>
            <strong>No moderation queue.</strong> Deliberately not built ahead of the feature. See{' '}
            <Link href="/tools/moderator-tools/photos">Moderator Tools › Photos</Link>, which makes
            the same argument from the other end.
          </li>
          <li>
            <strong>No re-hosting of the images that do exist.</strong> Copying{' '}
            {census.offsite} hotlinked images into Storage would remove a real fragility and needs
            step 1 above — it is the cheapest thing on this page that is worth doing.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
