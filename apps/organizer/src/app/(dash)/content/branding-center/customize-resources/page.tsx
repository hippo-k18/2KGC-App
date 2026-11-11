import Link from 'next/link';
import { publicSiteOrigin } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listDocuments, listPages } from '@/lib/planning';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';
import { PageForm, type EditablePage } from './page-form';

export const dynamic = 'force-dynamic';

/**
 * Content › Branding Center › Customize Resources.
 *
 * Whova's screen is a navigation editor wearing a branding hat: rename the
 * app's own menu items, hide one, and add resources of your own. Two of those
 * three are still impossible here and the note below still says so — but the
 * third, "add a resource", is what an organizer is nearly always after, and it
 * is what this screen now does.
 *
 * ── Why the tabs are still fixed, and a page is not ─────────────────────────
 *
 * The app's tabs are **native tabs**: `app/src/app/(tabs)/_layout.tsx` declares
 * five `NativeTabs.Trigger` elements at build time, each carrying an SF Symbol
 * for iOS and a vector icon for Android. A label read from Firestore at runtime
 * would still leave the set, the order and the icons compiled in, so a rename
 * control here would let an organizer change three words and imply they could
 * rearrange the app. A page is the opposite: its whole content is data, one
 * route renders any number of them on the phone and one more on the website, so
 * nothing about it is a promise the build cannot keep.
 *
 * ── The body is Markdown and the renderer never sees HTML ───────────────────
 *
 * `@kgc/shared`'s `parseRichText` returns blocks, not markup, and all three
 * surfaces put the author's text in text nodes. That is why this screen can
 * offer a rich-text box at all without a sanitiser: there is no path from the
 * box to an HTML parser. See `rich-text-core.ts`.
 */
export default async function CustomizeResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string }>;
}) {
  await requireOrganizer();
  const { edit, new: creating } = await searchParams;

  const [pages, documents] = await Promise.all([listPages(), listDocuments()]);

  const editingPage = edit ? pages.find((p) => p.id === edit) : undefined;
  const showForm = Boolean(creating) || Boolean(editingPage);

  const editing: EditablePage | undefined = editingPage
    ? {
        id: editingPage.id,
        title: editingPage.title,
        slug: editingPage.slug,
        body: editingPage.body,
        summary: editingPage.summary,
        published: editingPage.published,
        order: editingPage.order,
      }
    : undefined;

  const published = pages.filter((p) => p.published);
  const origin = publicSiteOrigin();

  return (
    <>
      <PageHeader
        title="Customize Resources"
        info={
          <>
            <strong>Pages you write yourself</strong>
            <p>
              A page is a title, a web address and some text. Published pages show on the website
              and in the app under Documents.
            </p>
            <p>The five app tabs are still fixed and cannot be renamed or reordered.</p>
          </>
        }
        tags={<Tag color="blue">{published.length} published</Tag>}
        actions={
          showForm ? (
            <Link
              href="/content/branding-center/customize-resources"
              className="whova-btn-main secondary"
            >
              Back to list
            </Link>
          ) : (
            <Link href="?new=1" className="whova-btn-main primary">
              + Add page
            </Link>
          )
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
          { label: 'Pages', value: pages.length, sub: `${published.length} live` },
          { label: 'App tabs', value: 5, sub: 'cannot be changed here' },
          { label: 'Documents', value: documents.length, sub: 'links you can edit' },
        ]}
      />

      {showForm ? (
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>
            {editing ? `Edit “${editing.title}”` : 'New page'}
          </h2>
          <PageForm existing={editing} />
        </Panel>
      ) : (
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Pages</h2>
          {pages.length === 0 ? (
            <NotInputted
              what="pages"
              action={
                <Link href="?new=1" className="whova-btn-main secondary">
                  Write the first one
                </Link>
              }
            />
          ) : (
            <Table
              stackSm
              cols={[
                { key: 't', label: 'Page', className: 'cell-fill' },
                { key: 'u', label: 'Web address', className: 'cell-md' },
                // "Length" of what, in what? It is the body, counted in characters.
                { key: 'l', label: 'Characters', className: 'cell-sm' },
                { key: 's', label: 'Status', className: 'cell-xs' },
                { key: 'a', label: '', className: 'cell-xs cell-end-align' },
              ]}
              rows={pages.map((p) => [
                <span key="t">
                  <strong>{p.title}</strong>
                  {p.summary && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      {p.summary}
                    </div>
                  )}
                </span>,
                p.published ? (
                  <a key="u" href={`${origin}/${p.slug}`} target="_blank" rel="noreferrer">
                    /{p.slug} ↗
                  </a>
                ) : (
                  <span key="u" className="muted" style={{ fontSize: 12 }}>
                    /{p.slug}
                  </span>
                ),
                <span key="l" className="muted" style={{ fontSize: 12 }}>
                  {p.length.toLocaleString('en-US')}
                </span>,
                <Tag key="s" color={p.published ? 'green' : 'grey'} fill="outline" small>
                  {p.published ? 'published' : 'not published'}
                </Tag>,
                <Link key="a" href={`?edit=${encodeURIComponent(p.id)}`} style={{ fontSize: 12 }}>
                  Edit
                </Link>,
              ])}
            />
          )}

          <p className="body-2" style={{ marginBottom: 0 }}>
            For a file somebody else is hosting, such as a map, a deck or a dataset, add a link on
            the <Link href="/content/documents-and-videos/documents">Documents</Link> screen
            instead.
          </p>
        </Panel>
      )}

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
            <strong>Images in a page.</strong> The body is text, links and lists. An image needs an
            upload path, which is the same gap <code>Documents</code> carries.
          </li>
          <li>
            <strong>Deleting a page.</strong> A page is retired by unpublishing it, for the reason
            there is no delete on rooms, tracks or documents.
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
