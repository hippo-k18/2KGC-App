import { useMemo } from 'react';
import { collection, query, where } from 'firebase/firestore';

import { COLLECTIONS, EVENT_ID, type SessionDoc, type WithId } from '@kgc/shared';

import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';

export type Session = WithId<SessionDoc>;

/**
 * Every published session for the event, live.
 *
 * The whole agenda is ~70 documents and a few hundred kilobytes, so it is
 * fetched once and filtered in memory. That buys three things a per-query
 * approach does not: filtering and search are instant, the screen keeps working
 * with no network once Firestore has cached it, and switching a track filter
 * costs nothing instead of a round trip on a saturated conference wifi.
 *
 * Subscribed rather than fetched because a room change made in the organizer
 * console has to reach a phone already looking at the agenda.
 */
export function useSessions() {
  const { data, error, loading } = useCollection<Session>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.sessions),
        where('eventId', '==', EVENT_ID),
        where('status', '==', 'published'),
      ),
    [],
    (id, d) => ({ id, ...d }) as Session,
    // Sorted client-side: ordering in the query would need another composite
    // index for no benefit at this size.
    (a, b) => a.startsAtLocal.localeCompare(b.startsAtLocal),
  );

  return { sessions: data, error, loading };
}

/** Distinct days present in the agenda, in order. */
export function useDays(sessions: Session[] | null): string[] {
  return useMemo(() => {
    if (!sessions) return [];
    return [...new Set(sessions.map((s) => s.day))].sort();
  }, [sessions]);
}

export interface AgendaFilters {
  day: string | null;
  trackId: string | null;
  search: string;
}

/**
 * Applies the filter bar to the loaded agenda.
 *
 * Search covers title, speaker names and room, because those are the three
 * things people actually type — "Hartmann", "SHACL" and "Bloomberg" should all
 * find the same session.
 */
export function filterSessions(sessions: Session[], f: AgendaFilters): Session[] {
  const needle = f.search.trim().toLowerCase();
  return sessions.filter((s) => {
    if (f.day && s.day !== f.day) return false;
    if (f.trackId && !(s.trackIds ?? []).includes(f.trackId)) return false;
    if (!needle) return true;
    return (
      s.title.toLowerCase().includes(needle) ||
      (s.speakerNames ?? []).some((n) => n.toLowerCase().includes(needle)) ||
      (s.roomName ?? '').toLowerCase().includes(needle)
    );
  });
}

/** `2027-05-04` → `Tue 4 May`, without pulling in a formatter. */
export function formatDayTab(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  // Constructed and read back as UTC, so the label never shifts with the
  // device's own zone — the day key is already event-local.
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${weekday} ${d} ${month}`;
}

/** `2027-05-04T14:30` → `2:30 PM`. */
export function formatTime(local: string): string {
  const [h, min] = local.split('T')[1].split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(min).padStart(2, '0')} ${suffix}`;
}
