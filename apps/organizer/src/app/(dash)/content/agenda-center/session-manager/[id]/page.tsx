import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrganizer } from '@/lib/auth';
import { getSession, listRooms, listSpeakerOptions, listTrackOptions } from '@/lib/data';
import { findConflicts } from '@/lib/conflicts';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatusTag } from '../../../../ui';
import { SessionForm } from '../session-form';
import { conflictsForSession } from '../session-core';

export const dynamic = 'force-dynamic';

export default async function SessionEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOrganizer();

  const { id } = await params;
  const [session, rooms, tracks, speakers, report] = await Promise.all([
    getSession(id),
    listRooms(),
    listTrackOptions(),
    listSpeakerOptions(),
    /**
     * The programme-wide conflict pass, narrowed to this session.
     *
     * Deliberately `findConflicts()` rather than anything written here: the
     * overlap arithmetic lives in exactly one place (`conflicts-core.ts`, pure
     * and tested) and a second opinion about what counts as a clash is how the
     * Conflict Check screen and this page start disagreeing about the same two
     * sessions. Running it on the *page* rather than inside the save action is
     * what makes it useful — a clash caused by editing some *other* session shows
     * up here too, and `revalidatePath` refreshes it the moment a save lands.
     */
    findConflicts(),
  ]);
  if (!session) notFound();

  const mine = conflictsForSession(report.conflicts, session.id);

  return (
    <>
      <PageHeader
        title="Edit Session"
        tags={<StatusTag status={session.status} />}
        actions={
          <Link href={ROUTES.sessionManager} className="whova-btn-main secondary">
            Back to list
          </Link>
        }
        links={[
          <Link key="sm" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="cc" href={ROUTES.conflictCheck}>
            Conflict Check
          </Link>,
          <span key="u" className="muted">
            last saved{' '}
            {session.updatedAt
              ? session.updatedAt.toDate().toISOString().slice(0, 16).replace('T', ' ')
              : 'never'}
          </span>,
        ]}
      />

      {mine.length ? (
        <Panel>
          <Banner kind={mine.some((c) => c.severity === 'error') ? 'danger' : 'warning'}>
            <strong>
              {mine.length} conflict{mine.length === 1 ? '' : 's'} involve this session.
            </strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {mine.map((c, i) => (
                <li key={i}>{c.summary}</li>
              ))}
            </ul>
          </Banner>
        </Panel>
      ) : null}

      <Panel>
        <SessionForm
          rooms={rooms}
          tracks={tracks}
          speakers={speakers}
          values={{
            id: session.id,
            title: session.title,
            description: session.description ?? '',
            roomId: session.roomId ?? '',
            startsAtLocal: session.startsAtLocal,
            endsAtLocal: session.endsAtLocal,
            status: session.status,
            format: session.format,
            skillLevel: session.skillLevel ?? '',
            capacity: session.capacity === undefined ? '' : String(session.capacity),
            speakerIds: session.speakerIds ?? [],
            trackIds: session.trackIds ?? [],
            timeZone: session.timeZone,
            version: session.updatedAt ? session.updatedAt.toMillis() : 0,
          }}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">On save</h2>
        <p className="body-2">
          Times are in <code>{session.timeZone}</code>. Saving updates the agenda and each
          speaker&apos;s page in the app. <Link href={ROUTES.report}>Report</Link> shows the
          history of changes.
        </p>
        <p className="body-2">
          Q&amp;A and polls for this session are toggled on{' '}
          <Link href={ROUTES.qaManager}>Session Q&amp;A Manager</Link>.
        </p>
      </Panel>
    </>
  );
}
