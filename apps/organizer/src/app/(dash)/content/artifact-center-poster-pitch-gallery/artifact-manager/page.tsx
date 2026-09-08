import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSessions } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Artifact Center › Artifact Manager.
 *
 * An artifact is a poster, a demo, a startup pitch or a gallery exhibit — the
 * things presented alongside the agenda rather than on it. KGC has posters, so
 * this is not a screen for somebody else's conference.
 *
 * **There is no artifact model.** Not a thin one, not a partial one: nothing in
 * `packages/shared/src/models.ts` describes a poster. That is why the count
 * below is of *sessions* formatted as posters rather than of artifacts, and why
 * that tile says so.
 *
 * The tempting shortcut — treat a poster as a `SessionDoc` with
 * `format: 'poster'` — is worth naming and rejecting here, because the next
 * person will think of it. A session has a start time, an end time and a room,
 * and those three are what the agenda is built from. A poster has a board
 * number, a presenter standing beside it for two hours, and a PDF. Forcing it
 * into a session either puts a poster on the agenda screen where it does not
 * belong, or adds a status the agenda has to filter out everywhere.
 *
 * The three screens beside this one — Message Presenters, Competition, Artifact
 * Streaming — are all downstream of the collection this screen does not have.
 */
export default async function ArtifactManagerPage() {
  await requireOrganizer();

  const sessions = await listSessions();
  const posterish = sessions.filter((s) => s.format === 'poster');

  return (
    <>
      <PageHeader
        title="Artifact Manager"
        info={
          <>
            <strong>No artifact collection exists</strong>
            <p>
              A poster is not a session with a flag. It has a board number, a presenter and a file
              rather than a start time and a room. Its own document type, and a screen in the app
              to read it, come before anything on this page.
            </p>
          </>
        }
        links={[
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="m" href="/content/artifact-center-poster-pitch-gallery/message-presenters">
            Message Presenters
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Artifacts', value: '—', sub: 'not inputted yet' },
          {
            label: 'Sessions marked poster',
            value: posterish.length,
            sub: 'on the agenda, not here',
          },
        ]}
      />

      <Panel>
        <NotInputted
          what="posters, demos or pitches"
          action={
            <Link className="whova-btn-main" href={ROUTES.sessionManager}>
              Poster sessions are on the agenda
            </Link>
          }
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>The collection.</strong> Nothing stores an artifact, and there is no screen in
            the app that would read one — posters sit most naturally under Agenda as a sibling of
            the day tabs, which is a design decision rather than a CRUD screen.
          </li>
          <li>
            <strong>Presenter records that are not speakers.</strong> A poster presenter is usually
            a PhD student who is not on the agenda, so reusing <code>speakers</code> would put them
            on the public speakers page.
          </li>
          <li>
            <strong>Presenter self-service.</strong> A personal link for a presenter to upload
            their own poster. That pattern exists in this project exactly once, for order
            confirmations, and has not been generalised.
          </li>
          <li>
            <strong>Board numbering.</strong> The same missing floor plan that blocks booth
            selection in the exhibitor hall.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
