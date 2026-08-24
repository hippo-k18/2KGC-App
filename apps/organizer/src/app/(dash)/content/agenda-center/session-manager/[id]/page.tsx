import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrganizer } from '@/lib/auth';
import { getSession, listRooms } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { PageHeader, Panel, StatusTag } from '../../../../ui';
import { SessionForm } from './session-form';

export const dynamic = 'force-dynamic';

export default async function SessionEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOrganizer();

  const { id } = await params;
  const [session, rooms] = await Promise.all([getSession(id), listRooms()]);
  if (!session) notFound();

  return (
    <>
      <PageHeader
        title="Edit Session"
        tags={
          <StatusTag status={session.status} />
        }
        links={[
          <Link key="sm" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <span key="id" className="muted">
            <code>{`sessions/${session.id}`}</code>
          </span>,
          <span key="u" className="muted">
            last saved{' '}
            {session.updatedAt ? session.updatedAt.toDate().toISOString().slice(0, 16).replace('T', ' ') : 'never'}
          </span>,
        ]}
      />

      <Panel>
        <SessionForm
          rooms={rooms}
          values={{
            id: session.id,
            title: session.title,
            description: session.description ?? '',
            roomId: session.roomId ?? '',
            startsAtLocal: session.startsAtLocal,
            endsAtLocal: session.endsAtLocal,
            status: session.status,
            timeZone: session.timeZone,
            day: session.day,
            sequence: session.sequence ?? 0,
            version: session.updatedAt ? session.updatedAt.toMillis() : 0,
          }}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">Derived on save</h2>
        <p className="body-2">
          <code>startsAt</code>, <code>endsAt</code> and <code>day</code> are recomputed from the
          wall clock above in <code>{session.timeZone}</code> every time you save, using the same{' '}
          <code>deriveTimes()</code> the seed and the Whova importer use. A 21:00 reception is 01:00
          UTC the next day; deriving <code>day</code> anywhere else puts it on the wrong tab on
          every phone. <Link href={ROUTES.report}>Report</Link> shows the audit trail.
        </p>
      </Panel>
    </>
  );
}
