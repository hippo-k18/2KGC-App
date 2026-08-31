import { collection, doc, query, where } from 'firebase/firestore';

import {
  COLLECTIONS,
  EVENT_ID,
  type ExhibitorListingDoc,
  type WithId,
} from '@kgc/shared';

import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';
import { useDocument } from '@/lib/data/use-document';

export type ExhibitorListing = WithId<ExhibitorListingDoc>;

/**
 * The exhibition hall.
 *
 * ## This reads a projection, and that is the whole point
 *
 * `exhibitors/{id}` is server-only and stays that way. It carries the booking
 * contact's name and email address, the number of staff passes the package
 * includes and how many have been used, and whether the booking is confirmed or
 * merely provisional — a space promised in a sales conversation that nobody has
 * paid for. Firestore rules filter documents, not fields, so there is no read
 * that hands over the name and withholds the rest.
 *
 * `exhibitorListings/{exhibitorId}` is therefore the same arrangement
 * `directory/{uid}` has with `users/{uid}`: a slim, server-written document
 * holding only what a thousand phones may see. An exhibitor who cancelled has no
 * listing at all rather than a filtered one, so nothing about them is on the
 * wire for a client-side filter to miss.
 *
 * ⚠️ **Nothing writes these documents on the live project except the seed.**
 * The production writer is a trigger on `exhibitors/{id}`, shaped like
 * `mirrorDirectory` and not yet built. Until it is, this list is as fresh as the
 * last `npm run seed`, and an empty hall here means "nothing has been projected"
 * rather than "no exhibitors". The screen says so rather than implying the hall
 * is empty.
 *
 * Sorted by booth number where there is one, because that is the order somebody
 * standing in the hall is walking in; the rest fall to the end alphabetically.
 * `booths` itself is not readable by any client and does not need to be — the
 * number is denormalised onto the listing, and the floor plan document carries
 * an order id, a ticket type and a `held`-but-unpaid state.
 */
export function useExhibitors() {
  const { data, error, loading, status, retry } = useCollection<ExhibitorListing>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.exhibitorListings),
        where('eventId', '==', EVENT_ID),
      ),
    [],
    (id, d) => ({ id, ...d }) as ExhibitorListing,
    (a, b) => {
      const boothA = a.boothNumber ?? '';
      const boothB = b.boothNumber ?? '';
      if (Boolean(boothA) !== Boolean(boothB)) return boothA ? -1 : 1;
      return boothA.localeCompare(boothB) || a.name.localeCompare(b.name);
    },
  );
  return { exhibitors: data, error, loading, status, retry };
}

/** One exhibitor's listing, for the detail card. */
export function useExhibitor(id: string | undefined) {
  const { data, error, status, retry } = useDocument<ExhibitorListing>(
    () => (id ? doc(getDb(), COLLECTIONS.exhibitorListings, id) : null),
    [id],
    (docId, d) => ({ id: docId, ...d }) as ExhibitorListing,
  );
  return { exhibitor: data, error, status, retry };
}
