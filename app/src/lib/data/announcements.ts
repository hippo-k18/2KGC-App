import { useMemo } from 'react';
import { collection, orderBy, query, where } from 'firebase/firestore';

import { COLLECTIONS, EVENT_ID, type AnnouncementDoc, type WithId } from '@kgc/shared';

import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';
import type { Session } from '@/lib/data/sessions';

export type Announcement = WithId<AnnouncementDoc>;

export function useAnnouncements(): Announcement[] {
  const { data } = useCollection<Announcement>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.announcements),
        where('eventId', '==', EVENT_ID),
        orderBy('createdAt', 'desc'),
      ),
    [],
    (id, d) => ({ id, ...d }) as Announcement,
  );
  return data ?? [];
}

/**
 * What is on now, and what is next.
 *
 * The comparison is done on the wall-clock strings rather than the UTC
 * instants, because "now" for an attendee means the venue's clock. Someone
 * checking the app from a hotel in another zone still wants the conference's
 * idea of now, not their device's.
 *
 * `reference` exists so the Home screen can be demonstrated outside the event
 * week: without it, every session is in the past and the screen looks broken.
 */
export function useNowNext(sessions: Session[] | null, reference?: Date) {
  return useMemo(() => {
    if (!sessions?.length) return { now: [], next: [], usingFallback: false };

    const stamp = toEventWallClock(reference ?? new Date());
    let now = sessions.filter((s) => s.startsAtLocal <= stamp && s.endsAtLocal > stamp);
    let next = sessions.filter((s) => s.startsAtLocal > stamp).slice(0, 3);

    // Outside the conference week there is nothing live. Rather than an empty
    // screen, fall back to the first day of the programme and say so.
    const usingFallback = now.length === 0 && next.length === 0;
    if (usingFallback) {
      const firstDay = sessions[0].day;
      const sameDay = sessions.filter((s) => s.day === firstDay);
      now = sameDay.slice(0, 1);
      next = sameDay.slice(1, 4);
    }

    return { now, next, usingFallback };
  }, [sessions, reference]);
}

/** `Date` → `YYYY-MM-DDTHH:mm` in the event's zone, for string comparison. */
function toEventWallClock(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
