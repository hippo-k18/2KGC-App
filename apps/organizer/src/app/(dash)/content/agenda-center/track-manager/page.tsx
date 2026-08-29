import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTracks } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PER_PAGE, PageHeader, Pagination, Panel, Table, listParams, paginate, sortRows } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content > Agenda Center > Track Manager.
 *
 * Read-only, and honestly so. Tracks are created by the importer
 * (`scripts/src/import-whova.ts`), which is the right place for them: tracks,
 * tags and categories are columns in the agenda sheet, created on import, and
 * skipping the taxonomy-management screens saves about four days. What an
 * organizer needs from this screen is not an editor — it is the answer to "is
 * anything mis-tracked", which is what the counts give.
 *
 * The counts add up to more than the number of sessions on purpose: sessions
 * are cross-listed into several tracks, which programme chairs do routinely,
 * and `primaryTrackName` decides which one shows on the agenda card.
 */
export default async function TrackManagerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const { page, sort, baseParams } = listParams(sp);
  const all = await listTracks();

  const tracks = sortRows(all, sort.by, sort.dir, {
    track: (t) => t.name,
    sessions: (t) => t.sessionCount,
    published: (t) => t.publishedCount,
    primary: (t) => t.primaryCount,
  });
  const pageRows = paginate(tracks, page, PER_PAGE);

  const orphans = all.filter((t) => t.sessionCount === 0);

  return (
    <>
      <PageHeader
        title="Track Manager"
        links={[
          <Link key="ac" href="/content/agenda-center">
            Agenda Center
          </Link>,
          <Link key="sm" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
        ]}
      />

      <Panel>
        <p className="body-2" style={{ marginTop: 0 }}>
          {all.length} tracks. Sessions can be cross-listed into several, so the counts below
          add up to more than the number of sessions.
        </p>

        {orphans.length > 0 ? (
          <Banner kind="warning">
            {orphans.length} track{orphans.length === 1 ? ' has' : 's have'} no sessions:{' '}
            {orphans.map((t) => t.name).join(', ')}. A track with nothing in it still renders as an
            empty filter chip in the attendee app.
          </Banner>
        ) : null}

        <Table
          cols={[
            { key: 'c', label: '', className: 'cell-xs' },
            { key: 'n', label: 'Track', className: 'cell-lg', sortKey: 'track' },
            { key: 'i', label: 'Id', className: 'cell-fill' },
            { key: 's', label: 'Sessions', className: 'cell-xs cell-end-align', sortKey: 'sessions' },
            { key: 'p', label: 'Published', className: 'cell-xs cell-end-align', sortKey: 'published' },
            { key: 'pr', label: 'Primary', className: 'cell-xs cell-end-align', sortKey: 'primary' },
          ]}
          sort={sort}
          empty="No tracks"
          rows={pageRows.map((t) => [
            <span
              key="c"
              aria-hidden="true"
              style={{
                background: t.color ?? 'var(--line-strong)',
                borderRadius: 3,
                display: 'inline-block',
                height: 14,
                width: 14,
              }}
            />,
            <span key="n">
              <strong>{t.name}</strong>
              {t.description ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  {t.description}
                </div>
              ) : null}
            </span>,
            <code key="i" style={{ fontSize: 12 }}>
              {t.id}
            </code>,
            t.sessionCount,
            t.publishedCount,
            t.primaryCount,
          ])}
        />
        <Pagination total={tracks.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <p className="body-2">
          Creating, renaming, recolouring and deleting a track. All four are cheap to build and
          expensive to get wrong: <code>SessionDoc</code> caches{' '}
          <code>primaryTrackName</code> and <code>primaryTrackColor</code> so the agenda list
          renders without N extra reads, so a rename here has to fan out across every session that
          cross-lists the track. Until that fan-out exists, renaming from the importer — which
          rewrites every session anyway — is the safe path.
        </p>
      </GapPanel>
    </>
  );
}
