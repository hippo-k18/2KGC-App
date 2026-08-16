import { collection, query, where } from 'firebase/firestore';

import { COLLECTIONS, EVENT_ID, type TrackDoc, type WithId } from '@kgc/shared';

import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';

export type Track = WithId<TrackDoc>;

/** The event's tracks. Eleven documents — loaded whole, sorted by name. */
export function useTracks(): Track[] {
  const { data } = useCollection<Track>(
    () => query(collection(getDb(), COLLECTIONS.tracks), where('eventId', '==', EVENT_ID)),
    [],
    (id, d) => ({ id, ...d }) as Track,
    (a, b) => a.name.localeCompare(b.name),
  );
  return data ?? [];
}
