import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSessions } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Artifact Center › Artifact Manager.
 *
 * Whova's word for a poster, a demo, a startup pitch or a gallery exhibit — the
 * things presented alongside the agenda rather than on it. KGC has posters, so
 * this is not a screen for somebody else's conference.
 *
 * **There is no artifact model.** Not a thin one, not a partial one: nothing in
 * `packages/shared/src/models.ts` describes a poster. That is the honest state,
 * and it is why the count below is of *sessions* formatted as posters rather
 * than of artifacts.
 *
 * The tempting shortcut — treat a poster as a `SessionDoc` with
 * `format: 'poster'` — is worth naming and rejecting here, because the next
 * person will think of it. A session has a start time, an end time and a room,
 * and those three are what the agenda is built from. A poster has a board
 * number, a presenter standing beside it for two hours, and a PDF. Forcing it
 * into a session either puts a poster on the agenda screen where it does not
 * belong, or adds a status the agenda has to filter out everywhere.
 */
export default async function ArtifactManagerPage() {
  await requireOrganizer();

  const sessions = await listSessions();
  const posterish = sessions.filter((s) => s.format === 'poster');

  return (
    <>
      <PageHeader
        title="Artifact Manager"
        links={[
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="m" href="/content/artifact-center-poster-pitch-gallery/message-presenters">
            Message Presenters
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>Nothing here is stored.</strong> No artifact collection exists, so there is no list
        to show, no upload to make and no presenter to assign. The figure below counts agenda
        sessions marked as posters, which is the nearest real data and is not the same thing.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Artifacts', value: '—', sub: 'no collection exists' },
          { label: 'Sessions marked poster', value: posterish.length, sub: 'on the agenda, not here' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          A catalogue of posters, demos and pitches, each with a title, an abstract, one or more
          presenters, a board or table number, an uploaded PDF or image, and a category. Attendees
          browse it in the app, and it drives the competition and the gallery screens beside this
          one.
        </p>

        <h2 className="section-header">What this would need</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>An <code>artifacts</code> collection</strong> — its own document type, not a
            session with a flag. See the header of this file for why that shortcut costs more than
            it saves.
          </li>
          <li>
            <strong>A read path in the app,</strong> which means a screen the five tabs currently
            have no room for. Posters would most naturally live under Agenda as a sibling of the day
            tabs, and that is a design decision, not a CRUD screen.
          </li>
          <li>
            <strong>File upload,</strong> which no screen in this project can do. A poster without
            its PDF is a title in a list.
          </li>
          <li>
            <strong>Presenter records</strong> that are not speakers. A poster presenter is usually
            a PhD student who is not on the agenda, so reusing <code>speakers</code> would put them
            on the public speakers page.
          </li>
        </ul>

        <p className="body-2">
          <strong>6–8 days</strong> for the manager and the app screen, plus whatever the first
          upload path costs, and the three screens beside this one are all downstream of it.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>The collection.</strong> Nothing stores an artifact.
          </li>
          <li>
            <strong>Presenter self-service.</strong> Whova lets a presenter upload their own poster
            through a personal link. That pattern exists in this project exactly once, for order
            confirmations, and has not been generalised.
          </li>
          <li>
            <strong>Board numbering.</strong> The same missing floor plan that blocks booth
            selection in the exhibitor hall.
          </li>
        </ul>
      </Panel>
    </>
  );
}
