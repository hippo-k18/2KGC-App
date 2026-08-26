import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listDocuments } from '@/lib/planning';
import { publicUrl } from '@/lib/webpages';
import { Banner, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Webpages › Artifact Webpage.
 *
 * Whova's "artifacts" are the handouts: slide decks, posters, white papers,
 * published as a public page so somebody who missed the talk can still read it.
 *
 * ── We have the documents and they are deliberately not public ──────────────
 *
 * `documents` is a real collection with a real editor, and `visibleToTicketTypes`
 * exists on every record precisely so a deck can be restricted to the people who
 * paid. The app enforces that. Publishing the same records to an open webpage
 * would quietly override the one field on the document whose entire purpose is
 * to stop that happening.
 *
 * So this screen splits the library by that field: what could go public, and
 * what is gated and must not. The gap is a page for the first group only —
 * which is a smaller and more defensible job than "publish the documents".
 */
export default async function ArtifactWebpagePage() {
  await requireOrganizer();
  const docs = await listDocuments();

  const published = docs.filter((d) => d.status === 'published');
  const open = published.filter((d) => d.visibleToTicketTypes.length === 0);
  const gated = published.filter((d) => d.visibleToTicketTypes.length > 0);
  const draft = docs.filter((d) => d.status !== 'published');

  return (
    <>
      <PageHeader
        title="Artifact Webpage"
        tags={<Tag color="red" fill="outline">no public page exists</Tag>}
        actions={
          <a href={publicUrl('/learn')} target="_blank" rel="noreferrer" className="whova-btn-main">
            Nearest live page: /learn ↗
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
        <code>visibleToTicketTypes</code> is what keeps a gated deck gated, so a public artifact page
        can only ever carry the ungated ones — {open.length} of the {published.length} published
        today.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Published', value: published.length, sub: draft.length > 0 ? `${draft.length} still draft` : 'nothing in draft' },
          { label: 'Could be public', value: open.length, sub: 'no ticket restriction' },
          { label: 'Must stay gated', value: gated.length, sub: 'restricted by ticket type' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What a public artifact page could carry</h2>
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
            d.visibleToTicketTypes.length === 0 ? (
              <Tag key="v" color="green" fill="outline" small>
                anyone
              </Tag>
            ) : (
              <span key="v" className="muted" style={{ fontSize: 12 }}>
                {d.visibleToTicketTypes.join(', ')} only
              </span>
            ),
          ])}
          empty="Nothing published yet. Documents is where these are added."
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>The public page.</strong> A route in <code>apps/web</code> listing the ungated
            documents. It must filter on <code>visibleToTicketTypes</code> server-side; a page that
            renders the whole collection and hides rows in CSS has published the gated ones.
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
      </Panel>
    </>
  );
}
