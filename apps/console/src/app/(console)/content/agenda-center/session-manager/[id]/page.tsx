import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOrganizer } from '@/lib/auth';
import { getSession, listRooms } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { SessionForm } from './session-form';

export const dynamic = 'force-dynamic';

export default async function SessionEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOrganizer();

  const { id } = await params;
  const [session, rooms] = await Promise.all([getSession(id), listRooms()]);
  if (!session) notFound();

  return (
    <>
      <h1>{session.title}</h1>
      <p className="muted">
        <code>{`sessions/${session.id}`}</code> · day <code>{session.day}</code> · sequence{' '}
        {session.sequence ?? 0} · last updated{' '}
        {session.updatedAt ? session.updatedAt.toDate().toISOString() : 'never'}
      </p>

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

      <h2>Derived on save</h2>
      <p className="muted">
        <code>startsAt</code>, <code>endsAt</code> and <code>day</code> are recomputed from the wall
        clock above in <code>{session.timeZone}</code> every time you save, using the same
        <code> deriveTimes()</code> the seed and the Whova importer use. A 21:00 reception is 01:00
        UTC the next day; deriving <code>day</code> anywhere else puts it on the wrong tab on every
        phone. <Link href={ROUTES.warRoom}>War room</Link> shows the audit trail.
      </p>
    </>
  );
}
