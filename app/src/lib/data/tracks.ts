import { collection, query, where } from 'firebase/firestore';

import { COLLECTIONS, EVENT_ID, type TrackDoc, type WithId } from '@kgc/shared';

import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';

export type Track = WithId<TrackDoc>;

/**
 * The event's tracks. Eleven documents — loaded whole, sorted by name.
 *
 * An object rather than a bare array: a refused read leaves the filter sheet
 * showing "All tracks" and nothing else, which looks like a single-track event
 * rather than a failure.
 */
export function useTracks() {
  const { data, error, retry } = useCollection<Track>(
    () => query(collection(getDb(), COLLECTIONS.tracks), where('eventId', '==', EVENT_ID)),
    [],
    (id, d) => ({ id, ...d }) as Track,
    (a, b) => a.name.localeCompare(b.name),
  );
  return { tracks: data ?? [], error, retry };
}
