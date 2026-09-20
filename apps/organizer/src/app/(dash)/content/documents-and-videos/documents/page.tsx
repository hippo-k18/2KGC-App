import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes } from '@/lib/commerce';
import { getDocument, listDocuments } from '@/lib/planning';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';
import { DocumentForm, type EditableDocument } from './document-form';

export const dynamic = 'force-dynamic';

/**
 * Content › Documents & Videos › Documents.
 *
 * ── ⚠️ These are links, not uploads ─────────────────────────────────────────
 *
 * `DocumentDoc.url` points at something hosted elsewhere. Firebase Storage is
 * live now and `lib/uploads.ts` writes to it, but only for the three *image*
 * fields it was built for — a document picker needs its own prefix in
 * `storage.rules`, a different type check and a much larger size cap. So the
 * control is a URL box and it is labelled "Link".
 *
 * AGENTS.md records that "the app claims capabilities it does not have" is this
 * project's recurring defect class, with fourteen known cases and three of them
 * introduced by agents cleaning up the other eleven. A drop zone here, or even
 * the word "upload" on the button, would be the fifteenth.
 *
 * ── The screen had a list and no writer ─────────────────────────────────────
 *
 * Every row in `documents` came from `seed-demo.ts`, and the header said "Add
 * via the form below" over a page with no form on it. The editor below is that
 * form; `actions.ts` is the writer, and its header explains why
 * `visibleToTicketTypes` is always written as an explicit array.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string }>;
}) {
  await requireOrganizer();
  const { edit, new: creating } = await searchParams;

  const [docs, ticketTypes] = await Promise.all([listDocuments(), listTicketTypes()]);
  const editingDoc = edit ? await getDocument(edit) : null;
  const showForm = Boolean(creating) || Boolean(editingDoc);

  const editing: EditableDocument | undefined = editingDoc
    ? {
        id: editingDoc.id,
        title: editingDoc.title,
        description: editingDoc.description ?? '',
        url: editingDoc.url ?? '',
        kind: editingDoc.kind ?? 'link',
        status: editingDoc.status ?? 'draft',
        order: editingDoc.order ?? 0,
        visibleToTicketTypes: editingDoc.visibleToTicketTypes ?? [],
      }
    : undefined;

  const published = docs.filter((d) => d.status === 'published');
  const broken = docs.filter((d) => !d.host);
  const restricted = docs.filter((d) => d.visibleToTicketTypes.length > 0);

  return (
    <>
      <PageHeader
        title="Documents"
        info={
          <>
            <strong>Links, not uploads</strong>
            <p>
              Host the file where you already do and paste the address. Anyone holding the link can
              open it. &ldquo;Visible to&rdquo; decides what the app <em>shows</em>, not who can
              reach the file.
            </p>
            <p>
              A document restricted to a ticket type is not shown in the app yet.
            </p>
          </>
        }
        tags={<Tag color="blue">{published.length} published</Tag>}
        actions={
          showForm ? (
            <Link href="/content/documents-and-videos/documents" className="whova-btn-main secondary">
              Back to list
            </Link>
          ) : (
            <Link href="?new=1" className="whova-btn-main primary">
              + Add document
            </Link>
          )
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

      {broken.length > 0 && !showForm ? (
        <Banner kind="danger">
          <strong>
            {broken.length} {broken.length === 1 ? 'document has' : 'documents have'} an address the
            app cannot open.
          </strong>{' '}
          Attendees see the row but it does not open. Edit it and paste a full{' '}
          <code>https://</code> address.
        </Banner>
      ) : null}

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
            sub: broken.length === 0 ? 'every link is valid' : 'not a valid address',
          },
        ]}
      />

      {showForm ? (
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>
            {editing ? `Edit “${editing.title}”` : 'New document'}
          </h2>
          <DocumentForm existing={editing} ticketTypeNames={ticketTypes.map((t) => t.name)} />
        </Panel>
      ) : (
        <Panel>
          {docs.length === 0 ? (
            <NotInputted
              what="documents"
              action={
                <Link href="?new=1" className="whova-btn-main secondary">
                  Add the first one
                </Link>
              }
            />
          ) : (
            <Table
              cols={[
                { key: 't', label: 'Document', className: 'cell-fill' },
                { key: 'k', label: 'Kind', className: 'cell-xs' },
                { key: 'h', label: 'Hosted at', className: 'cell-md' },
                { key: 'v', label: 'Visible to', className: 'cell-md' },
                { key: 's', label: 'Status', className: 'cell-xs' },
                { key: 'a', label: '', className: 'cell-xs cell-end-align' },
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
                <Link key="a" href={`?edit=${encodeURIComponent(d.id)}`} style={{ fontSize: 12 }}>
                  Edit
                </Link>,
              ])}
            />
          )}
        </Panel>
      )}

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Attaching a file.</strong> The bucket is live and{' '}
            <code>lib/uploads.ts</code> writes to it, but only for images: a document picker needs
            its own prefix in <code>storage.rules</code>, a type check that is not &ldquo;is this a
            PNG&rdquo;, and a size cap an order of magnitude above a logo&rsquo;s.
          </li>
          <li>
            <strong>Real access control.</strong> &ldquo;Visible to&rdquo; hides a row in the app.
            The link itself stays public — anyone who has it can open it, whatever their ticket.
            Enforcing that needs signed URLs, which needs the files to be ours.
          </li>
          <li>
            <strong>Deleting a document.</strong> A row is retired by setting it back to draft.
            There is no delete, for the same reason there is none on rooms or tracks.
          </li>
          <li>
            <strong>Download counts.</strong> Nothing measures whether anyone opened it.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
