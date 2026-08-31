import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { getTrack, listTracks } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, PER_PAGE, PageHeader, Pagination, Panel, Table, listParams, paginate, sortRows } from '../../../ui';
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
            <Link href="?new=1" className="whova-btn-main">
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
            {all.length} tracks. Sessions can be cross-listed into several, so the counts below
            add up to more than the number of sessions — and only the primary track, the first one
            on the session, is the one an attendee sees on the agenda card.
          </p>

          {orphans.length > 0 ? (
            <Banner kind="warning">
              {orphans.length} track{orphans.length === 1 ? ' has' : 's have'} no sessions:{' '}
              {orphans.map((t) => t.name).join(', ')}. A track with nothing in it still renders as an
              empty filter chip in the attendee app.
            </Banner>
          ) : null}

          {colourless.length > 0 ? (
            <Banner kind="info">
              {colourless.length} track{colourless.length === 1 ? '' : 's'} have no colour, so their
              agenda cards fall back to the app&rsquo;s default stripe and stop being
              distinguishable at a glance. The Whova importer does not write colours; this screen
              does.
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
              { key: 'a', label: '', className: 'cell-xs cell-end-align' },
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
              <Link key="a" href={`?edit=${encodeURIComponent(t.id)}`} style={{ fontSize: 12 }}>
                Edit
              </Link>,
            ])}
          />
          <Pagination total={tracks.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />

          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 12 }}>
            <strong>There is no delete.</strong> Sessions carry track ids, and Firestore has no
            cascade — a deleted track leaves them pointing at nothing, with the name needed to
            repair them gone too. A track that is finished with is taken off its sessions in{' '}
            <Link href={ROUTES.sessionManager}>Session Manager</Link>; it then appears in the
            warning above, which is the honest place for it.
          </p>
        </Panel>
      )}

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Import a track list
        </h2>
        <p className="body-2">
          A track is keyed by its name, so re-importing the same sheet updates the colours and
          descriptions in place. ⚠️ Changing a <em>name</em> in the file does not rename anything
          &mdash; it adds a second track and leaves the first on every session referencing it, and
          there is no delete to clean that up. Rename above instead.
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          A changed colour is rewritten onto every session whose primary track this is, in the same
          run. One cell can restyle sixty agenda cards, and the result below says how many.
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
          Agenda cache check
        </h2>
        <p className="body-2">
          Every session stores a copy of its speakers&rsquo; names, its primary track&rsquo;s name
          and colour, and its room&rsquo;s name, so the agenda renders without four extra reads per
          row. Saving a speaker, a track or a room rewrites those copies as part of the save. This
          rebuilds all of them from source, which is what to run after a bulk import, or if a save
          reported that some sessions failed.
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          On healthy data it writes nothing at all — it reproduces exactly what the importer and
          the seed produce. Check first; repair only if the check finds drift.
        </p>
        <CacheTools />
      </Panel>
    </>
  );
}
