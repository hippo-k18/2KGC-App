import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { imageCensus } from '@/lib/images';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Photos › Photo Collection.
 *
 * ── The blocker is the app, not the gallery and no longer Storage ──────────
 *
 * A photo wall is attendees posting pictures during the event. Building the
 * wall first is not the missing half: **the app has no image picker**, so there
 * is nothing for a wall to show.
 *
 * ⚠️ Storage stopped being the blocker on 2026-09-01. The bucket exists,
 * `storage.rules` is published to it, and `lib/uploads.ts` writes through it
 * from Exhibitor, Sponsor and Speaker Manager. Any comment here or elsewhere
 * saying nothing in this project uploads a file predates that. What is still
 * true is that most images this event holds are URLs somebody typed or an
 * importer copied — which is what the census below measures.
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
        info={
          <>
            <strong>A count, not a gallery</strong>
            <p>
              Attendees cannot post photos from the app yet. This screen counts the images the
              event already has and where each one is hosted.
            </p>
          </>
        }
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

      <StatTiles
        tiles={[
          { label: 'Images held', value: census.totalImages, sub: 'logos, headshots and profile photos' },
          { label: 'Uploaded here', value: census.uploaded, sub: 'the rest are links' },
          { label: 'Hosted elsewhere', value: census.offsite, sub: 'linked, not uploaded' },
          { label: 'Attendee photos', value: census.sources[2]?.withImage ?? 0, sub: `of ${census.sources[2]?.total ?? 0} profiles` },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Images and where they are hosted</h2>
        <Table
          cols={[
            { key: 'l', label: 'Images of', className: 'cell-md' },
            { key: 'n', label: 'Have one', className: 'cell-sm' },
            { key: 'h', label: 'Hosted on', className: 'cell-fill' },
            { key: 'e', label: 'Edited at', className: 'cell-md' },
          ]}
          rows={census.sources.map((s) => [
            <div key="l">{s.label}</div>,
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
                not editable here
              </span>
            ),
          ])}
          empty={<NotInputted what="images" />}
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          A linked image disappears if the site hosting it removes it. To keep it, open its row
          and upload a copy.
        </p>
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
            {census.offsite} hotlinked images into Storage would remove a real fragility, and since
            2026-09-01 nothing blocks it — the write path exists. It is the cheapest thing on this
            page worth doing and it is not done.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
