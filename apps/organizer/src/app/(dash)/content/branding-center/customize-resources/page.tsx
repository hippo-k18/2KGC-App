import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listDocuments } from '@/lib/planning';
import { PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Branding Center › Customize Resources.
 *
 * Whova&rsquo;s screen renames the app&rsquo;s own menu items and adds custom
 * entries — turn &ldquo;Community&rdquo; into &ldquo;Networking&rdquo;, hide
 * &ldquo;Photos&rdquo;, add a &ldquo;Shuttle Times&rdquo; link. It is a
 * navigation editor wearing a branding hat.
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
          { label: 'App tabs', value: 5, sub: 'fixed at build time' },
          { label: 'Documents', value: documents.length, sub: 'links an organizer can already edit' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          Renames, reorders, hides and adds items in the attendee app&rsquo;s menu, and lets an
          organizer point a new item at a web page. Most events use it for one thing: a
          &ldquo;Venue&rdquo; or &ldquo;Shuttle&rdquo; entry that the standard menu has no slot for.
        </p>

        <h2 className="section-header">Why ours cannot do it</h2>
        <p className="body-2">
          The five tabs are declared in <code>app/src/app/(tabs)/_layout.tsx</code> and compiled into
          the bundle. Each needs an iOS SF Symbol <em>and</em> an Android vector icon — supply only
          the first and Android ships labels with no icons — so a new entry is not a row in a
          database, it is a code change and an app-store release. Renaming alone could be read from
          Firestore, but shipping only that would suggest the menu is editable when its shape,
          order and icons are not.
        </p>

        <h2 className="section-header">What to do instead, today</h2>
        <p className="body-2">
          Add it as a document. The Documents screen writes a titled link that the app already
          renders, which covers the shuttle timetable, the venue map PDF and the code of conduct —
          which is what this screen is used for in practice. It is a worse place to put it than a
          menu item, and it needs no release.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
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
      </Panel>
    </>
  );
}
