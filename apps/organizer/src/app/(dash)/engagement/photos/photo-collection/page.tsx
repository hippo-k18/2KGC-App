import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { Banner, PageHeader, Panel, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Photos › Photo Collection.
 *
 * Whova collects attendee photos into a shared album, moderated, downloadable
 * by the organizer afterwards.
 *
 * ── Nothing here is modelled, and the missing piece is not the model ────────
 *
 * There is no `photos` collection, no Storage bucket path, no upload control in
 * the app and no moderation queue for images. Adding the document type would be
 * an hour; it would also be the least useful hour available, because the real
 * shape of this feature is *uploads by strangers*, and that is a different class
 * of problem from every other write in this app.
 *
 * A photo upload is unbounded in size, un-typed until inspected, expensive to
 * store, impossible to un-see once shown, and — at a conference — routinely
 * contains people who did not agree to be photographed. Whova solves this with
 * pre-moderation, which means somebody sitting with a queue during the event.
 * That staffing requirement is the honest reason this sits behind the whole
 * engagement tab rather than the technical one, and it is what this screen says.
 */
export default async function PhotoCollectionPage() {
  await requireOrganizer();

  // Ordered by which one stops the feature first. The bucket is trivial; the
  // person watching the queue on Tuesday is not.
  const NEEDS = [
    {
      piece: 'A Storage path and rules',
      note: 'storage.rules exists and no screen in this repo uploads anything. Images are the first write that is not a small JSON document.',
      hard: 'small' as const,
    },
    {
      piece: 'An upload control in the app',
      note: 'expo-image-picker is not a dependency, and picking a photo needs a permission prompt on both platforms.',
      hard: 'small' as const,
    },
    {
      piece: 'A photos collection and an album screen',
      note: 'Neither exists. A grid in the app plus a moderation list here.',
      hard: 'medium' as const,
    },
    {
      piece: 'Pre-moderation, staffed',
      note: 'Board moderation is reactive — hide it after it appears. A photo cannot be un-seen, so images need approval before display, which means somebody watching a queue during the event.',
      hard: 'large' as const,
    },
    {
      piece: 'Consent and takedown',
      note: 'Conference photos contain people who did not agree to be in them. A takedown route has to exist before the first upload, not after the first complaint.',
      hard: 'large' as const,
    },
  ];

  return (
    <>
      <PageHeader
        title="Photo Collection"
        tags={<Tag color="red" fill="outline">nothing modelled</Tag>}
        links={[
          <Link key="f" href="/engagement/photos/profile-photo-frames">
            Profile photo frames
          </Link>,
          <Link key="b" href="/engagement/photos/photo-booth">
            Photo booth
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>There is no photo feature of any kind.</strong> No collection, no Storage path, no
        upload control, no album. The blocker worth planning around is not the code — it is that
        photographs need approval <em>before</em> anyone sees them, and that means a person watching
        a queue while the conference is running.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What this would take, hardest last</h2>
        <Table
          cols={[
            { key: 'p', label: 'Piece', className: 'cell-md' },
            { key: 'h', label: 'Size', className: 'cell-sm' },
            { key: 'n', label: '', className: 'cell-fill' },
          ]}
          rows={NEEDS.map((n) => [
            n.piece,
            <Tag
              key="h"
              color={n.hard === 'small' ? 'green' : n.hard === 'medium' ? 'orange' : 'red'}
              fill="outline"
              small
            >
              {n.hard}
            </Tag>,
            <span key="n" className="muted" style={{ fontSize: 12 }}>
              {n.note}
            </span>,
          ])}
        />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
          The two red rows are policy, not engineering, which is why this is not a weekend&rsquo;s
          work even though the first three rows are.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Everything on this screen.</strong> Uploading, browsing, moderating,
            downloading, or deleting a photo — none of it exists anywhere in the repo.
          </li>
          <li>
            <strong>The Photos entry under Moderator Tools.</strong> It is in the nav and it moderates
            a queue that has nothing in it, for the same reason.
          </li>
          <li>
            <strong>Storage in general.</strong> Sponsor logos, speaker headshots and documents are
            all <em>links</em> to files hosted elsewhere. This dashboard has never written a byte to
            Cloud Storage, and photo collection would be the first feature that had to.
          </li>
        </ul>
      </Panel>
    </>
  );
}
