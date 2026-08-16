import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTracks } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * Content > Agenda Center > Track Manager.
 *
 * Read-only, and honestly so. Tracks are created by the importer
 * (`scripts/src/import-whova.ts`), which is the right place for them: §35.1
 * says tracks, tags and categories are columns in the agenda sheet, created on
 * import, and that skipping the taxonomy-management screens saves ~4 days. What
 * an organizer needs from this screen is not an editor — it is the answer to
 * "is anything mis-tracked", which is what the counts below give.
 */
export default async function TrackManagerPage() {
  await requireOrganizer();
  const tracks = await listTracks();

  const orphans = tracks.filter((t) => t.sessionCount === 0);

  return (
    <>
      <p className="crumbs">
        <Link href="/content">Content</Link> {' › '}
        <Link href="/content/agenda-center">Agenda Center</Link> {' › '}
      </p>
      <h1>Track Manager</h1>
      <p className="muted">
        {tracks.length} tracks. Sessions can be cross-listed into several — programme chairs do
        that routinely — so the counts below add up to more than the number of sessions.
      </p>

      <table>
        <thead>
          <tr>
            <th style={{ width: 24 }} />
            <th>Track</th>
            <th>Id</th>
            <th style={{ textAlign: 'right' }}>Sessions</th>
            <th style={{ textAlign: 'right' }}>Published</th>
            <th style={{ textAlign: 'right' }}>Primary</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((t) => (
            <tr key={t.id}>
              <td>
                <span
                  aria-hidden
                  style={{
                    display: 'inline-block',
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    background: t.color ?? '#ccc',
                    border: '1px solid #0002',
                  }}
                />
              </td>
              <td>
                <strong>{t.name}</strong>
                {t.description ? <div className="muted">{t.description}</div> : null}
              </td>
              <td>
                <code>{t.id}</code>
              </td>
              <td style={{ textAlign: 'right' }}>
                {t.sessionCount === 0 ? <span className="error">0</span> : t.sessionCount}
              </td>
              <td style={{ textAlign: 'right' }}>{t.publishedCount}</td>
              <td style={{ textAlign: 'right' }}>{t.primaryCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="muted" style={{ maxWidth: 780 }}>
        <strong>Primary</strong> counts the sessions whose agenda card shows this track.{' '}
        <code>primaryTrackName</code> and <code>primaryTrackColor</code> are denormalised onto the
        session so the agenda list renders without N extra reads; nothing is ever decided from
        them, and the importer owns them — which is why this screen does not offer to edit them.
      </p>

      {orphans.length > 0 ? (
        <p className="error">
          {orphans.length} track{orphans.length === 1 ? '' : 's'} with no sessions:{' '}
          {orphans.map((t) => t.name).join(', ')}. Harmless, but it means an empty filter chip in
          the app.
        </p>
      ) : null}

      <h2>Not built here</h2>
      <ul className="muted" style={{ maxWidth: 780 }}>
        <li>
          <strong>Create, rename and delete a track.</strong> Tracks arrive with the agenda import
          (§11.2 — Column D of the Excel template, with a configurable separator for multi-track
          sessions). Renaming one means rewriting the cached <code>primaryTrackName</code> on every
          session that carries it, so it belongs in the importer, not in a text field here.
        </li>
        <li>
          <strong>Bulk assign tracks to sessions.</strong> §11.7 — Whova&apos;s bulk-edit lets you
          pick or create a value and apply it to a selection. §35.1 explicitly trades that away:
          build import and export and edit-one-session, skip the bulk-edit UI, and save ~15–20 days.
        </li>
        <li>
          <strong>Track colours.</strong> Set by the importer. The app reads them for the coloured
          dots on agenda cards.
        </li>
      </ul>
    </>
  );
}
