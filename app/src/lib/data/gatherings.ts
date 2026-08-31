import { collection } from 'firebase/firestore';

import {
  COLLECTIONS,
  SUBCOLLECTIONS,
  type GatheringPlacementDoc,
  type WithId,
} from '@kgc/shared';

import { useAuth } from '@/lib/auth/auth-provider';
import { useCollection } from '@/lib/data/use-collection';
import { getDb } from '@/lib/firebase/client';

export type GatheringPlacement = WithId<GatheringPlacementDoc>;

/**
 * "Which table am I at?" — `users/{uid}/gatherings/{gatheringId}`.
 *
 * ── ⚠️ Read this before wiring anything to it ───────────────────────────────
 *
 * **This reader has no writer, on purpose, and the reason is a modelling gap
 * rather than an unfinished job.** The organizer dashboard has the whole seating
 * machinery — `apps/organizer/src/lib/gatherings.ts` enforces capacity in a
 * transaction, refuses to shrink a table below the people already placed at it,
 * and detects room clashes — and none of it can be projected onto an attendee
 * today, because `GatheringDoc.attendees` is a list of **names typed by an
 * organizer**, not uids. That is itself deliberate: half the people at a sponsor
 * meeting hold no ticket and have no account. It leaves a mirror with no join
 * key, and the tempting join — a typed name against `UserDoc.name` — seats the
 * wrong Chen at the wrong table. A confidently wrong seat is worse than no seat:
 * one person walks to a room where they are not expected while the person who
 * was actually placed there is told nothing.
 *
 * So the writer is a follow-up and it needs the *plan* to carry a uid first: an
 * organizer picking an attendee out of the directory, with free text kept for
 * the guests who have no account. Until then this returns an empty list and the
 * surface that renders it draws nothing — absence, not a claim.
 *
 * ── Why not read `gatherings` directly ──────────────────────────────────────
 *
 * `gatherings/{id}` has no `match` block in `firestore.rules` and must not get
 * one. One plan document carries every other name at the table, `notes` — where
 * the reason somebody was seated away from somebody else gets written — and
 * `status: 'planned'`, a table sketched and not agreed. Rules filter documents
 * and not fields, so there is no predicate that returns the caller's own seat
 * and withholds the eleven beside it. The answer is a projection, the same one
 * `directory` gives for `users` and `exhibitorListings` gives for `exhibitors`.
 */
export function useMyGatherings() {
  const { user } = useAuth();

  const { data, error, status, retry } = useCollection<GatheringPlacement>(
    () =>
      collection(
        getDb(),
        COLLECTIONS.users,
        user?.uid ?? '_',
        // The subcollection, never the top-level collection of the same name.
        SUBCOLLECTIONS.gatherings,
      ),
    [user?.uid],
    (id, d) => ({ id, ...d }) as GatheringPlacement,
    // Day then start time then title, matching how the dashboard orders the
    // plan it was projected from, so the printed table card and the phone agree.
    (a, b) =>
      (a.day ?? '').localeCompare(b.day ?? '') ||
      (a.startsAtLocal ?? '').localeCompare(b.startsAtLocal ?? '') ||
      a.title.localeCompare(b.title),
  );

  return {
    /**
     * `[]` covers both "no placements" and "not loaded yet"; `status` and
     * `error` tell them apart. Callers that render this must not read an empty
     * list as a settled answer — see `use-collection.ts`.
     */
    placements: data ?? [],
    error,
    status,
    retry,
  };
}

/** Where and when, as one line. Empty when the organizer set neither. */
export function placementWhen(p: GatheringPlacement): string {
  const time = [p.startsAtLocal, p.endsAtLocal].filter(Boolean).join('–');
  return [p.day, time, p.roomName].filter(Boolean).join(' · ');
}
