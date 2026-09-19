import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listDocuments } from '@/lib/planning';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Branding Center › Customize Resources.
 *
 * Renaming the app's own menu items and adding custom entries — turn
 * "Community" into "Networking", hide "Photos", add a "Shuttle Times" link. It
 * is a navigation editor wearing a branding hat.
 *
 * ── Why this is not a settings form ─────────────────────────────────────────
 *
 * Ours are **native tabs**. `app/src/app/(tabs)/_layout.tsx` declares five
 * `NativeTabs.Trigger` elements at build time, each carrying an SF Symbol for
 * iOS and a vector icon for Android — the icon has to be specified twice or
 * Android renders labels with no icons at all. A label read from Firestore at
 * runtime would still leave the tab set, its order and its icons compiled in, so
 * a form here would let an organizer rename three things and imply they could
 * rearrange the app. That is the capability-claiming defect this repo keeps
 * making, so the honest version is a note.
 */
export default async function CustomizeResourcesPage() {
  await requireOrganizer();

  // The nearest thing that does exist: documents are links an organizer already
  // controls, and they are the answer to most "add a resource" requests.
  const documents = await listDocuments();

  return (
    <>
      <PageHeader
        title="Customize Resources"
        info={
          <>
            <strong>The app tabs are fixed</strong>
            <p>Custom app tabs are not available yet. Add links as documents instead.</p>
          </>
        }
        links={[
          <Link key="d" href="/content/documents-and-videos/documents">
            Documents
          </Link>,
          <Link key="a" href="/content/branding-center/app-branding">
            App Branding
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'App tabs', value: 5, sub: 'cannot be changed here' },
          { label: 'Documents', value: documents.length, sub: 'links you can edit' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Add it as a document instead</h2>
        <p className="body-2">
          Add a titled link on the{' '}
          <Link href="/content/documents-and-videos/documents">Documents</Link> screen and it shows
          in the app. Use it for things like the shuttle timetable, the venue map and the code of
          conduct.
        </p>
        {documents.length === 0 ? (
          <NotInputted
            what="documents"
            action={
              <Link
                className="whova-btn-main"
                href="/content/documents-and-videos/documents?new=1"
              >
                Add the first one
              </Link>
            }
          />
        ) : null}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Renaming a tab.</strong> Possible in isolation — a settings read in the tab
            layout — and deliberately not shipped alone, because it implies the rest.
          </li>
          <li>
            <strong>Hiding or reordering tabs.</strong> Native tab order is fixed by the order of
            the JSX children on SDK 54.
          </li>
          <li>
            <strong>Adding a menu item.</strong> Needs a route, two icons and a release.
          </li>
          <li>
            <strong>Per-language labels.</strong> The app has no i18n layer at all — every string is
            an English literal in a component.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
