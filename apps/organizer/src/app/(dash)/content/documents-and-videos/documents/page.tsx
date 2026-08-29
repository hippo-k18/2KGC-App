import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listDocuments } from '@/lib/planning';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Documents & Videos › Documents.
 *
 * ── ⚠️ These are links, not uploads, and the screen says so twice ───────────
 *
 * `DocumentDoc.url` points at something hosted elsewhere. Firebase Storage
 * rules exist in this repo but **no upload UI does anywhere** — there is no
 * file picker, no resize pipeline, nothing that puts bytes into a bucket.
 *
 * AGENTS.md records that "the app claims capabilities it does not have" is this
 * project's recurring defect class, with fourteen known cases and three of them
 * introduced by agents cleaning up the other eleven. A drop zone here, or even
 * the word "upload" in a button, would be the fifteenth. So the field is
 * labelled "Link" and the banner says it outright.
 */
export default async function DocumentsPage() {
  await requireOrganizer();
  const docs = await listDocuments();

  const published = docs.filter((d) => d.status === 'published');
  const broken = docs.filter((d) => !d.host);
  const restricted = docs.filter((d) => d.visibleToTicketTypes.length > 0);

  return (
    <>
      <PageHeader
        title="Documents"
        tags={<Tag color="blue">{published.length} published</Tag>}
        actions={
          <span className="muted" style={{ fontSize: 12 }}>
            Add via the form below
          </span>
        }
        links={[
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="t" href={ROUTES.createTickets}>
            Ticket types
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>Documents are links, not uploads.</strong> Nothing in this project puts a file into
        storage — there is no file picker anywhere. Host the PDF or deck wherever you already do
        (Drive, Dropbox, the website) and paste the URL. Anyone with the link can open it: this
        list controls what the app <em>shows</em>, not who can reach the file.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Documents', value: docs.length, sub: `${published.length} live in the app` },
          {
            label: 'Restricted',
            value: restricted.length,
            sub: 'shown only to some ticket types',
          },
          {
            label: 'Broken links',
            value: broken.length,
            sub: broken.length === 0 ? 'all parse' : 'not a valid URL',
          },
        ]}
      />

      <Panel>
        {docs.length === 0 ? (
          <EmptyState icon="◫">
            <strong>No documents yet.</strong>
            <p className="muted" style={{ marginTop: 6 }}>
              Slide decks, the venue map, a code of conduct PDF, sponsor one-pagers — anything you
              want attendees to be able to open from the app.
            </p>
          </EmptyState>
        ) : (
          <Table
            cols={[
              { key: 't', label: 'Document', className: 'cell-fill' },
              { key: 'k', label: 'Kind', className: 'cell-xs' },
              { key: 'h', label: 'Hosted at', className: 'cell-md' },
              { key: 'v', label: 'Visible to', className: 'cell-md' },
              { key: 's', label: 'Status', className: 'cell-xs' },
            ]}
            rows={docs.map((d) => [
              <span key="t">
                {d.host ? (
                  <a href={d.url} target="_blank" rel="noreferrer">
                    {d.title} ↗
                  </a>
                ) : (
                  <strong>{d.title}</strong>
                )}
                {d.description && (
                  <div className="muted" style={{ fontSize: 11 }}>
                    {d.description}
                  </div>
                )}
              </span>,
              <Tag key="k" color="grey" fill="outline" small>
                {d.kind}
              </Tag>,
              d.host ? (
                <span key="h" className="muted" style={{ fontSize: 12 }}>
                  {d.host}
                </span>
              ) : (
                <Tag key="h" color="red" fill="outline" small>
                  not a URL
                </Tag>
              ),
              <span key="v" style={{ fontSize: 12 }}>
                {d.visibleToTicketTypes.length === 0 ? (
                  <span className="muted">everyone</span>
                ) : (
                  d.visibleToTicketTypes.join(', ')
                )}
              </span>,
              <Tag key="s" color={d.status === 'published' ? 'green' : 'grey'} fill="outline" small>
                {d.status}
              </Tag>,
            ])}
          />
        )}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Uploading a file.</strong> The single biggest gap on this screen. Storage rules
            exist; a picker, a size limit, a type check and a progress bar do not.{' '}
            <code>ROADMAP.md</code> counts roughly eighteen screens blocked on the same thing.
          </li>
          <li>
            <strong>Real access control.</strong> &ldquo;Visible to&rdquo; hides a row in the app.
            The link itself stays public — anyone who has it can open it, whatever their ticket.
            Enforcing that needs signed URLs, which needs the files to be ours.
          </li>
          <li>
            <strong>Download counts.</strong> Nothing measures whether anyone opened it.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
