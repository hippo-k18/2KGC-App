import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { exhibitorSummary, getExhibitor, listExhibitors } from '@/lib/exhibitors';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, GapPanel, PER_PAGE, PageHeader, Pagination, Panel, ProgressBar, SearchInput, StatTiles, Table, Tag, listParams, paginate, sortRows } from '../../../ui';
import { setExhibitorStatusAction } from './actions';
import { ExhibitorForm } from './exhibitor-form';

export const dynamic = 'force-dynamic';

/**
 * Content › Exhibitor Center › Exhibitor Manager.
 *
 * Separate from Sponsor Manager on purpose. A sponsor buys visibility — a tier,
 * a logo, a banner. An exhibitor buys floor space — a booth, staff passes,
 * somewhere to scan leads. The fields barely intersect, and Whova sells them as
 * two products. A company that is both is two records, which is correct: they
 * bought two things.
 */
export default async function ExhibitorManagerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const { page, sort, baseParams } = listParams(sp);
  const editId = typeof sp.edit === 'string' ? sp.edit : undefined;
  const creating = typeof sp.new === 'string';

  const [all, summary] = await Promise.all([listExhibitors(), exhibitorSummary()]);
  const editingDoc = editId ? await getExhibitor(editId) : null;
  const editing = editingDoc ? all.find((e) => e.id === editingDoc.id) : undefined;
  const showForm = creating || Boolean(editing);

  const q = String(sp.q ?? '').trim().toLowerCase();
  const filtered = all.filter((e) =>
    !q
      ? true
      : [e.name, e.boothNumber, e.contactName, e.contactEmail].some((v) =>
          v.toLowerCase().includes(q),
        ),
  );

  const rows = paginate(
    sortRows(filtered, sort.by, sort.dir, {
      name: (e) => e.name,
      booth: (e) => e.boothNumber || '￿',
      status: (e) => e.status,
      passes: (e) => e.passesUsed,
    }),
    page,
    PER_PAGE,
  );

  return (
    <>
      <PageHeader
        title="Exhibitor Manager"
        tags={<Tag color="blue">{summary.confirmed} confirmed</Tag>}
        actions={
          !showForm ? (
            <Link href="?new=1" className="whova-btn-main">
              + Add exhibitor
            </Link>
          ) : (
            <Link href="/content/exhibitor-center/exhibitor-manager" className="whova-btn-main secondary">
              Back to list
            </Link>
          )
        }
        links={[
          <Link key="s" href={ROUTES.sponsorManager}>
            Sponsor Manager
          </Link>,
          <Link key="x" href={ROUTES.analyticsExports}>
            Exports
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Exhibitors', value: summary.total, sub: `${summary.provisional} provisional` },
          {
            label: 'Without a booth',
            value: summary.withoutBooth,
            sub: summary.withoutBooth === 0 ? 'all placed' : 'not on the floor plan',
          },
          {
            label: 'Staff passes',
            value: `${summary.passesUsed} / ${summary.passesAllocated}`,
            sub: summary.overAllocated > 0 ? `${summary.overAllocated} over allocation` : 'within allocation',
          },
          {
            label: 'No contact',
            value: summary.withoutContact,
            sub: 'cannot be messaged',
          },
        ]}
      />

      {summary.overAllocated > 0 && (
        <Banner kind="danger">
          <strong>{summary.overAllocated} exhibitor{summary.overAllocated === 1 ? ' has' : 's have'} claimed more staff passes than their package allows.</strong>{' '}
          Worth settling before doors open — it is otherwise an argument at the desk with somebody
          who is already holding a box of leaflets.
        </Banner>
      )}

      {showForm ? (
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>
            {editing ? `Edit ${editing.name}` : 'New exhibitor'}
          </h2>
          <ExhibitorForm existing={editing} />
        </Panel>
      ) : (
        <Panel>
          <div style={{ alignItems: 'center', display: 'flex', gap: 12, marginBottom: 12 }}>
            <SearchInput placeholder="Company, booth, contact…" />
          </div>

          {all.length === 0 ? (
            <EmptyState
              icon="▤"
              action={
                <Link href="?new=1" className="whova-btn-main">
                  Add the first exhibitor
                </Link>
              }
            >
              <strong>No exhibitors yet.</strong>
              <p className="muted" style={{ marginTop: 6 }}>
                These are the companies with a booth in the hall, as distinct from sponsors, who
                buy visibility rather than floor space.
              </p>
            </EmptyState>
          ) : (
            <>
              <Table
                sort={sort}
                cols={[
                  { key: 'b', label: 'Booth', className: 'cell-xs', sortKey: 'booth' },
                  { key: 'n', label: 'Company', className: 'cell-fill', sortKey: 'name' },
                  { key: 'c', label: 'Contact', className: 'cell-md' },
                  { key: 'p', label: 'Passes', className: 'cell-sm', sortKey: 'passes' },
                  { key: 's', label: 'Status', className: 'cell-sm', sortKey: 'status' },
                  { key: 'a', label: '', className: 'cell-sm' },
                ]}
                rows={rows.map((e) => [
                  e.boothNumber ? (
                    <strong key="b">{e.boothNumber}</strong>
                  ) : (
                    <Tag key="b" color="orange" fill="outline" small>
                      none
                    </Tag>
                  ),
                  <span key="n">
                    {e.website ? (
                      <a href={e.website} target="_blank" rel="noreferrer">
                        {e.name}
                      </a>
                    ) : (
                      e.name
                    )}
                    {e.description && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {e.description.slice(0, 90)}
                        {e.description.length > 90 ? '…' : ''}
                      </div>
                    )}
                  </span>,
                  <span key="c" style={{ fontSize: 12 }}>
                    {e.contactEmail ? (
                      <>
                        {e.contactName || e.contactEmail}
                        <div className="muted" style={{ fontSize: 11 }}>
                          {e.contactEmail}
                        </div>
                      </>
                    ) : (
                      <span className="muted">none on file</span>
                    )}
                  </span>,
                  <span key="p">
                    {typeof e.passesAllocated === 'number' ? (
                      <>
                        <span style={{ fontSize: 13 }}>
                          {e.passesUsed} / {e.passesAllocated}
                        </span>
                        <ProgressBar
                          pct={Math.min(100, (e.passesUsed / Math.max(1, e.passesAllocated)) * 100)}
                        />
                      </>
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>
                        not set
                      </span>
                    )}
                  </span>,
                  <Tag
                    key="s"
                    color={e.status === 'confirmed' ? 'green' : e.status === 'cancelled' ? 'red' : 'orange'}
                    fill="outline"
                    small
                  >
                    {e.status}
                  </Tag>,
                  <div key="a" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <Link href={`?edit=${e.id}`} style={{ fontSize: 12 }}>
                      Edit
                    </Link>
                    {/*
                      A form, not a link: cancelling an exhibitor is a write, and
                      a GET that changes state is one prefetch away from taking a
                      paying company off the floor plan.
                    */}
                    <form action={setExhibitorStatusAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <input
                        type="hidden"
                        name="status"
                        value={e.status === 'cancelled' ? 'provisional' : 'cancelled'}
                      />
                      <button
                        type="submit"
                        style={{
                          background: 'none',
                          border: 0,
                          color: e.status === 'cancelled' ? 'var(--link)' : 'var(--danger, #b3352c)',
                          cursor: 'pointer',
                          fontSize: 12,
                          padding: 0,
                        }}
                      >
                        {e.status === 'cancelled' ? 'Reinstate' : 'Cancel'}
                      </button>
                    </form>
                  </div>,
                ])}
              />
              <Pagination total={filtered.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
            </>
          )}
        </Panel>
      )}

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Lead scanning.</strong> The commercial reason a company buys a booth. Sponsors
            have a <code>leads</code> subcollection modelled; exhibitors have nothing, and the app
            has no scanner for either.
          </li>
          <li>
            <strong>Exhibitor tickets.</strong> Whova sells staff passes through a parallel ticket
            catalogue. <code>TicketAudience</code> allows for it and no screen builds one, so passes
            here are a number in a contract rather than issued badges.
          </li>
          <li>
            <strong>Booth selection.</strong> Whova lets an exhibitor pick their own booth off a
            floor plan. There is no floor plan.
          </li>
          <li>
            <strong>Logos.</strong> <code>logoURL</code> exists on the record and nothing uploads
            one — no screen in this dashboard can put a file into storage.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
