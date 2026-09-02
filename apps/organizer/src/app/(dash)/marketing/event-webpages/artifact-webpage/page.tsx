import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listDocuments } from '@/lib/planning';
import { publicUrl } from '@/lib/webpages';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Webpages › Artifact Webpage.
 *
 * Whova's "artifacts" are the handouts: slide decks, posters, white papers,
 * published as a public page so somebody who missed the talk can still read it.
 *
 * ── Half the library is public, and the other half must never be ────────────
 *
 * `documents` is a real collection with a real editor, and `visibleToTicketTypes`
 * exists on every record precisely so a deck can be restricted to the people who
 * paid. Publishing the whole collection to an open webpage would quietly
 * override the one field whose entire purpose is to stop that happening.
 *
 * So the public page — `/documents`, built and linked from the site footer —
 * carries the ungated records and only those, and this screen splits the
 * library the same way so an organizer can see which side of the line each one
 * lands on before they publish it.
 *
 * ⚠️ **The filter is server-side, in `listPublicDocuments()`, and it is not a
 * parameter.** A restricted document is never sent to the browser at all. The
 * shape that looks equivalent and is not — render every row and hide the gated
 * ones with a class — publishes them: the URL is in the page source whether or
 * not a browser draws it, and these are links to files hosted elsewhere, so
 * such a leak is permanent and nothing in this repo can revoke it. If that
 * page ever grows a "show all" toggle, this is the paragraph it broke.
 *
 * ⚠️ **The counts here are the public reader's predicate, not an approximation
 * of it.** They were `visibleToTicketTypes.length === 0` over rows normalised
 * with `?? []`, which made a document with the field *absent* count as public —
 * the one reading `listPublicDocuments()` refuses by name — and ignored its
 * requirements for a real `url` and a `title`. The banner then told an organizer
 * that N of M documents were live on a page rendering fewer. `DocumentRow`
 * carries the predicate now; if that page's filter changes, that field's comment
 * is where the change has to be mirrored.
 */
export default async function ArtifactWebpagePage() {
  await requireOrganizer();
  const docs = await listDocuments();

  const published = docs.filter((d) => d.status === 'published');
  /*
   * `onPublicPage` is `listPublicDocuments()`'s own predicate, carried across
   * in `lib/planning.ts` — not `visibleToTicketTypes.length === 0`, which this
   * screen used and which counts a document the page refuses. See that field's
   * comment: absence is not permission, and a row with no link is not a row.
   */
  const open = published.filter((d) => d.onPublicPage);
  const gated = published.filter((d) => d.ticketRestricted);
  /*
   * Published, unrestricted, and still not rendered: no link, no title, or a
   * `visibleToTicketTypes` that is not an array at all. A fault rather than a
   * policy, and the only one of the three states an organizer can fix by
   * editing the document.
   */
  const incomplete = published.filter((d) => !d.onPublicPage && !d.ticketRestricted);
  const draft = docs.filter((d) => d.status !== 'published');

  return (
    <>
      <PageHeader
        title="Artifact Webpage"
        tags={<Tag color="green" fill="outline">live at /documents</Tag>}
        actions={
          <a href={publicUrl('/documents')} target="_blank" rel="noreferrer" className="whova-btn-main">
            View the live page ↗
          </a>
        }
        links={[
          <Link key="d" href="/content/documents-and-videos/documents">
            Documents
          </Link>,
          <Link key="v" href="/content/documents-and-videos/attendee-video-access">
            Attendee video access
          </Link>,
        ]}
      />

      <Banner kind="info">
        Handouts live in <strong>Documents</strong> and the app shows them to attendees.{' '}
        <code>visibleToTicketTypes</code> is what keeps a gated deck gated, so{' '}
        <a href={publicUrl('/documents')} target="_blank" rel="noreferrer">
          /documents
        </a>{' '}
        carries the ungated ones and only those — {open.length} of the {published.length} published
        today. Restricting a document here removes it from that page on the next request.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Published', value: published.length, sub: draft.length > 0 ? `${draft.length} still draft` : 'nothing in draft' },
          {
            label: 'On the public page',
            value: open.length,
            sub:
              incomplete.length > 0
                ? `${incomplete.length} published but incomplete`
                : 'no ticket restriction',
          },
          { label: 'Held back', value: gated.length, sub: 'restricted by ticket type' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Which of these a visitor can see</h2>
        <Table
          cols={[
            { key: 't', label: 'Title', className: 'cell-fill' },
            { key: 'k', label: 'Kind', className: 'cell-sm' },
            { key: 'h', label: 'Hosted at', className: 'cell-md' },
            { key: 'v', label: 'Visibility', className: 'cell-md' },
          ]}
          rows={published.map((d) => [
            d.title,
            <Tag key="k" color="grey" fill="outline" small>
              {d.kind}
            </Tag>,
            d.host ? (
              <code key="h" style={{ fontSize: 12 }}>
                {d.host}
              </code>
            ) : (
              // A row that reads "not a URL" is worth showing: it is a typo an
              // organizer can fix, and it would 404 on any page that used it.
              <span key="h" className="muted" style={{ fontSize: 12 }}>
                not a URL
              </span>
            ),
            d.onPublicPage ? (
              <Tag key="v" color="green" fill="outline" small>
                anyone
              </Tag>
            ) : d.ticketRestricted ? (
              <span key="v" className="muted" style={{ fontSize: 12 }}>
                {d.visibleToTicketTypes.join(', ')} only
              </span>
            ) : (
              // Published, open to everyone, and still not on the page. Saying
              // "anyone" here would be the same lie the counts above told, and
              // saying "restricted" would send the organizer to the wrong field.
              <span key="v" className="muted" style={{ fontSize: 12 }}>
                incomplete — not on the page
              </span>
            ),
          ])}
          empty="Nothing published yet. Documents is where these are added."
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Anything for the gated half.</strong> <code>/documents</code> publishes the
            ungated records; the restricted ones reach attendees through the app and nowhere else.
            A signed-in web view of them would need an auth path <code>apps/web</code> does not
            have — it is a trusted server with no attendee sign-in on it — so this is a real gap
            and not one worth closing with a capability token per document.
          </li>
          <li>
            <strong>File hosting.</strong> Every document is a <em>link</em> to something living
            elsewhere. Nothing in this repo uploads a file, so &ldquo;publish the poster&rdquo;
            currently means &ldquo;paste a URL somebody else is hosting&rdquo;.
          </li>
          <li>
            <strong>Download counts.</strong> Whova reports how many times each artifact was
            fetched. The links point off-site, so this dashboard could not count them even if
            something asked it to.
          </li>
          <li>
            <strong>Speaker upload.</strong> Chasing a deck is Message Speakers today. A form the
            speaker fills in themselves needs an auth path they do not have.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
