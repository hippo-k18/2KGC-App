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
 *
 * ## `deletedAt`
 *
 * `SessionDoc.deletedAt` is the soft delete — a session is never hard-deleted,
 * because attendees have it saved and Firestore has no server-side cascade. The
 * website already discards those rows (`apps/web/src/lib/data.ts:201`) and so do
 * five places in the dashboard; this query did not, so the same programme read
 * two ways gave two different answers.
 *
 * **Nothing in the repository writes the field today** — every one of the six
 * references to it is a reader, checked across the whole tree, so no session is
 * currently hidden on the website and shown here. This is therefore a latent
 * divergence rather than a live bug, and it is fixed now precisely because it is
 * latent: the day something starts writing `deletedAt` — a delete button on the
 * dashboard is Wave 2 work — a cancelled session would quietly stay on every
 * phone in the room while the website stopped listing it, and the two surfaces
 * would disagree about what the programme is.
 *
 * Filtered in memory rather than in the query. Firestore has no "field is
 * absent" predicate: `where('deletedAt', '==', null)` matches an explicit null
 * and not a missing key, so as a query clause it would drop every session ever
 * written — which is all of them.
 */
export function useSessions() {
  const { data, error, loading, retry } = useCollection<Session>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.sessions),
        where('eventId', '==', EVENT_ID),
        where('status', '==', 'published'),
      ),
    [],
    (id, d) => ({ id, ...d }) as Session,
    // Sorted client-side: ordering in the query would need another composite
    // index for no benefit at this size. Coalesced because a session authored
    // without a start time would otherwise throw out of `localeCompare` and
    // cost the whole agenda, not just its own row.
    (a, b) => (a.startsAtLocal ?? '').localeCompare(b.startsAtLocal ?? ''),
  );

  // `null` is preserved rather than collapsed to `[]`: every screen reading this
  // hook tells "nothing loaded" apart from "nothing to show", and filtering must
  // not turn the first into the second.
  const sessions = useMemo(
    () => (data ? data.filter((s) => !s.deletedAt) : null),
    [data],
  );

  return { sessions, error, loading, retry };
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
 * Whether the search box holds a query, by the same rule `filterSessions` uses.
 *
 * Exported so the screen cannot disagree with the predicate about it. The day
 * strip's appearance and the wording of the empty state both hang off this
 * answer, and a screen that thought it was searching while the filter thought it
 * was not would show the cross-day chrome over a single day's results.
 */
export function isSearching(search: string): boolean {
  return search.trim().length > 0;
}

/**
 * Applies the filter bar to the loaded agenda.
 *
 * Search covers title, speaker names and room — Whova's own documented scope
 * ("search session name, location or speaker name"), and the three things people
 * actually type: "Hartmann", "SHACL" and "Bloomberg" should all find the same
 * session.
 *
 * **A query searches the whole agenda, not the selected day.** This is the one
 * place the day strip stops applying, and it is deliberate. On a five-day
 * programme a day-scoped search returns nothing four times out of five, and the
 * empty list is indistinguishable from "that person is not speaking at this
 * conference" — so an attendee who searches a speaker's name from Monday
 * concludes the session does not exist. It is the same failure as a filter you
 * have forgotten is on, which is the complaint the persistent track filter above
 * this was written to answer; scoping search to a day recreated it in the one
 * control where the user has no way to see the filter at all.
 *
 * Whova's own help text is silent on which days its search covers, so this is a
 * divergence only if Whova narrows — and it is the same class of documented
 * divergence as the persistent track filter. The screen pays for it by saying
 * what it searched: while a query is active the day strip is replaced by a line
 * naming the number of days and the track, and the no-results state names the
 * query and the scope.
 *
 * The track filter still applies during a search, because the header carries the
 * active track's name the whole time and so that narrowing is never invisible.
 */
export function filterSessions(sessions: Session[], f: AgendaFilters): Session[] {
  const needle = f.search.trim().toLowerCase();
  const day = needle ? null : f.day;
  return sessions.filter((s) => {
    if (day && s.day !== day) return false;
    if (f.trackId && !(s.trackIds ?? []).includes(f.trackId)) return false;
    if (!needle) return true;
    return (
      s.title.toLowerCase().includes(needle) ||
      (s.speakerNames ?? []).some((n) => n.toLowerCase().includes(needle)) ||
      (s.roomName ?? '').toLowerCase().includes(needle)
    );
  });
}

/**
 * `2027-05-04` → `Tue 4 May`, without pulling in a formatter.
 *
 * A malformed day key yields `''` rather than a throw. Both formatters are
 * called from inside list renderers, where throwing does not blank one label —
 * it unmounts the screen. A missing time in one row is a cosmetic defect; an
 * agenda that will not render is not.
 */
export function formatDayTab(day: string): string {
  const [y, m, d] = (day ?? '').split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  // Constructed and read back as UTC, so the label never shifts with the
  // device's own zone — the day key is already event-local.
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  if (!weekday || !month) return '';
  return `${weekday} ${d} ${month}`;
}

/** `2027-05-04T14:30` → `2:30 PM`, or `''` when the wall clock is missing. */
export function formatTime(local: string): string {
  const time = (local ?? '').split('T')[1];
  if (!time) return '';
  const [h, min] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return '';
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(min).padStart(2, '0')} ${suffix}`;
}
