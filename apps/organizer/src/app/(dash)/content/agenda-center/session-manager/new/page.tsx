import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listRooms, listSpeakerOptions, listTrackOptions } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { todayInEventZone } from '@/lib/time';
import { TIME_ZONE } from '@kgc/shared';
import { PageHeader, Panel } from '../../../../ui';
import { SessionForm } from '../session-form';

export const dynamic = 'force-dynamic';

/**
 * Add a session.
 *
 * Whova opens this as a modal from the hour bucket you clicked in, and it
 * prefills that hour. The bucket's "Add session" link carries `day` and `hour`
 * for exactly that reason — clicking the 2 PM bucket should not then ask you
 * what time it is.
 *
 * A route rather than a modal, for the same reason the edit screen is one: the
 * URL is shareable, a mistyped date survives a refresh, and the create and edit
 * forms are then literally the same component rather than two that drift.
 */

/** One hour, in wall clock, with no date arithmetic anywhere near a timezone. */
function plusOneHour(hour: number): number {
  return (hour + 1) % 24;
}

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; hour?: string }>;
}) {
  await requireOrganizer();

  const { day, hour } = await searchParams;
  const [rooms, tracks, speakers] = await Promise.all([
    listRooms(),
    listTrackOptions(),
    listSpeakerOptions(),
  ]);

  /**
   * The default day is today *in the event's zone*, never the server's. A
   * dashboard rendered on a machine in UTC would otherwise offer tomorrow's date
   * to an organizer sitting in New York at 8pm.
   */
  const startDay = /^\d{4}-\d{2}-\d{2}$/.test(day ?? '') ? day! : todayInEventZone();
  const parsedHour = Number(hour);
  const startHour = Number.isInteger(parsedHour) && parsedHour >= 0 && parsedHour <= 23 ? parsedHour : 9;
  const hh = (h: number) => String(h).padStart(2, '0');

  /**
   * A one-hour default, and it deliberately does not roll over midnight: an
   * `endsAtLocal` on the next calendar day would be a legitimate value the
   * server accepts, and offering it as a *default* from the 11 PM bucket is how
   * somebody saves a reception that ends at 00:00 on the day it started. The
   * 23:00 bucket therefore offers 23:00–23:59 and asks to be corrected.
   */
  const endHour = plusOneHour(startHour);
  const endsAtLocal =
    endHour === 0 ? `${startDay}T23:59` : `${startDay}T${hh(endHour)}:00`;

  return (
    <>
      <PageHeader
        title="Add Session"
        links={[
          <Link key="sm" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="cc" href={ROUTES.conflictCheck}>
            Conflict Check
          </Link>,
          <span key="tz" className="muted">
            times are wall clock in {TIME_ZONE}
          </span>,
        ]}
      />

      <Panel>
        <SessionForm
          rooms={rooms}
          tracks={tracks}
          speakers={speakers}
          values={{
            title: '',
            description: '',
            roomId: '',
            startsAtLocal: `${startDay}T${hh(startHour)}:00`,
            endsAtLocal,
            status: 'draft',
            format: 'talk',
            skillLevel: '',
            capacity: '',
            speakerIds: [],
            trackIds: [],
            timeZone: TIME_ZONE,
            version: 0,
          }}
        />
      </Panel>

      <Panel>
        <h2 className="section-header">What happens when you press Create</h2>
        <p className="body-2">
          One document is written, in one transaction. <code>startsAt</code>, <code>endsAt</code> and{' '}
          <code>day</code> are derived from the wall clock above in <code>{TIME_ZONE}</code> by the
          same <code>deriveTimes()</code> the seed and the Whova importer use — a 21:00 reception is
          01:00 UTC the next day, and deriving <code>day</code> anywhere else puts it on the wrong tab
          on every phone. The id is derived from the title and the start time, so a later import of
          the same programme updates this session instead of duplicating it, and pressing Create
          twice is refused rather than saved twice.
        </p>
        <p className="body-2">
          A new session starts as a <strong>draft</strong>, which is invisible to attendees. Conflict
          Check still looks at drafts, so a room clash shows up before you publish rather than after.
        </p>
      </Panel>
    </>
  );
}
