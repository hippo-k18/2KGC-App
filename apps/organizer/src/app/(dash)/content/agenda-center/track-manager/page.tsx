import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { getTrack, listTracks } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, NotInputted, PER_PAGE, PageHeader, Pagination, Panel, Table, listParams, paginate, sortRows } from '../../../ui';
import { CsvImportPanel } from '../../csv-import-panel';
import { commitTrackImportAction, previewTrackImportAction } from './actions';
import { CacheTools } from './cache-tools';
import { TrackForm, type EditableTrack } from './track-form';

export const dynamic = 'force-dynamic';

/**
 * Content > Agenda Center > Track Manager.
 *
 * Tracks are the filter chips an attendee taps in the app, and they are now
 * editable here as well as importable from the agenda sheet. The counts still
 * lead the screen, because "is anything mis-tracked" remains what an organizer
 * opens this page to answer; the editor is what they reach for once the answer
 * is yes.
 *
 * The counts add up to more than the number of sessions on purpose: sessions
 * are cross-listed into several tracks, which programme chairs do routinely,
 * and only `trackIds[0]` — the primary — decides which name and colour appear
 * on the agenda card. That distinction is why the table has both a Sessions
 * and a Primary column, and why a rename affects fewer cards than it does
 * sessions.
 *
 * ── There is no delete ──────────────────────────────────────────────────────
 *
 * `trackIds` on every session points at these ids, and Firestore has no
 * cascade. Deleting a track leaves each of those sessions carrying an id that
 * resolves to nothing — which the reconciler below can detect but cannot
 * repair, because the name it would need is gone with the document. The house
 * pattern is retirement, not deletion (`setExhibitorStatusAction` cancels;
 * `firestore.rules:388` refuses a session delete outright), and a track is
 * retired by taking it off its sessions in Session Manager. The warning banner
 * for a track with nothing in it is what makes that state visible.
 */
export default async function TrackManagerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const { page, sort, baseParams } = listParams(sp);
  const editId = typeof sp.edit === 'string' ? sp.edit : undefined;
  const creating = typeof sp.new === 'string';
  const all = await listTracks();

  const doc = editId ? await getTrack(editId) : null;
  const row = doc ? all.find((t) => t.id === doc.id) : undefined;
  /** Plain values only — `getTrack` carries Firestore `Timestamp`s. */
  const editing: EditableTrack | undefined = doc
    ? {
        id: doc.id,
        name: doc.name,
        color: doc.color,
        description: doc.description,
        sessionCount: row?.sessionCount ?? 0,
        primaryCount: row?.primaryCount ?? 0,
      }
    : undefined;
  const showForm = creating || Boolean(editing);

  const tracks = sortRows(all, sort.by, sort.dir, {
    track: (t) => t.name,
    sessions: (t) => t.sessionCount,
    published: (t) => t.publishedCount,
    primary: (t) => t.primaryCount,
  });
  const pageRows = paginate(tracks, page, PER_PAGE);

  const orphans = all.filter((t) => t.sessionCount === 0);
  const colourless = all.filter((t) => !t.color);

  return (
    <>
      <PageHeader
        title="Track Manager"
        actions={
          showForm ? (
            <Link href={ROUTES.trackManager} className="whova-btn-main secondary">
              Back to list
            </Link>
          ) : (
            <Link href="?new=1" className="whova-btn-main primary">
              + Add track
            </Link>
          )
        }
        links={[
          <Link key="ac" href="/content/agenda-center">
            Agenda Center
          </Link>,
          <Link key="sm" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
        ]}
      />

      {showForm ? (
        <Panel>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            {editing ? `Edit ${editing.name}` : 'New track'}
          </h2>
          <TrackForm existing={editing} />
        </Panel>
      ) : (
        <Panel>
          <p className="body-2" style={{ marginTop: 0 }}>
            {all.length} tracks. A session can be in several tracks, so the counts below add up to
            more than the number of sessions. Attendees see only the first track on the agenda
            card.
          </p>

          {orphans.length > 0 ? (
            <Banner kind="warning">
              {orphans.length} track{orphans.length === 1 ? ' has' : 's have'} no sessions:{' '}
              {orphans.map((t) => t.name).join(', ')}. An empty track still shows as a filter in the
              attendee app.
            </Banner>
          ) : null}

          {colourless.length > 0 ? (
            <Banner kind="info">
              {colourless.length} track{colourless.length === 1 ? ' has' : 's have'} no colour, so
              their agenda cards use the default colour. Set one below.
            </Banner>
          ) : null}

          {all.length === 0 ? (
            <NotInputted
              what="tracks"
              action={
                <Link className="whova-btn-main secondary" href="?new=1">
                  Add the first one
                </Link>
              }
            />
          ) : (
            <>
          <Table
            cols={[
              { key: 'c', label: '', className: 'cell-xs' },
              { key: 'n', label: 'Track', className: 'cell-fill', sortKey: 'track' },
              { key: 's', label: 'Sessions', className: 'cell-xs cell-end-align', sortKey: 'sessions' },
              { key: 'p', label: 'Published', className: 'cell-xs cell-end-align', sortKey: 'published' },
              { key: 'pr', label: 'Primary', className: 'cell-xs cell-end-align', sortKey: 'primary' },
              { key: 'a', label: '', className: 'cell-xs cell-end-align' },
            ]}
            sort={sort}
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
              t.sessionCount,
              t.publishedCount,
              t.primaryCount,
              <Link key="a" href={`?edit=${encodeURIComponent(t.id)}`} style={{ fontSize: 12 }}>
                Edit
              </Link>,
            ])}
          />
          <Pagination total={tracks.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
            </>
          )}

          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
            <strong>Tracks cannot be deleted.</strong> Remove the track from its sessions in{' '}
            <Link href={ROUTES.sessionManager}>Session Manager</Link> instead.
          </p>
        </Panel>
      )}

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Import a track list
        </h2>
        <p className="body-2">
          Tracks are matched by name, so importing the same sheet again updates colours and
          descriptions. Changing a <em>name</em> in the file adds a second track. To rename a
          track, edit it above.
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          A changed colour is applied to every session that has the track first. The result below
          says how many.
        </p>
        <CsvImportPanel
          previewAction={previewTrackImportAction}
          commitAction={commitTrackImportAction}
          nounSingular="track"
          nounPlural="tracks"
          columnHint={
            <>
              Needs a <strong>Track</strong> column. Colour (six hex digits) and Description are
              used if present. &ldquo;Category&rdquo;, &ldquo;Topic&rdquo; and &ldquo;Theme&rdquo;
              all match the name column.
            </>
          }
          placeholder={'Track,Colour,Description\nGraph ML,#2180b2,Learning over graph structure'}
          additiveNote={
            <>
              Nothing was removed. A track missing from the file stays, along with every session
              cross-listed into it.
            </>
          }
        />
      </Panel>

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Agenda check
        </h2>
        <p className="body-2">
          Checks that every session shows the current speaker names, track name and colour, and
          room name. Run it after a bulk import, or if a save reported that some sessions failed.
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          Check first. Repair only if the check finds a difference.
        </p>
        <CacheTools />
      </Panel>
    </>
  );
}
