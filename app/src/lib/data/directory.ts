import { useCallback, useMemo } from 'react';
import { collection, deleteDoc, doc, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

import {
  COLLECTIONS,
  EVENT_ID,
  SUBCOLLECTIONS,
  type DirectoryDoc,
  type SpeakerDoc,
  type SponsorDoc,
  type WithId,
} from '@kgc/shared';

import { getDb } from '@/lib/firebase/client';
import { useAuth } from '@/lib/auth/auth-provider';
import { useCollection } from '@/lib/data/use-collection';
import { runWrite, type WriteResult } from '@/lib/data/write';

export type DirectoryEntry = WithId<DirectoryDoc>;
export type Speaker = WithId<SpeakerDoc>;
export type Sponsor = WithId<SponsorDoc>;

/**
 * The attendee directory, loaded whole and searched in memory.
 *
 * At 1,000 attendees the projection is roughly 450 KB and about $0.30 of reads
 * for the entire event. In-memory search is sub-millisecond, matches on any
 * field, works offline once cached, and needs no search service. Typesense only
 * starts to earn its keep above roughly 3,000–5,000 people.
 *
 * A hidden attendee has no `directory` document at all — the projection is
 * deleted when they opt out, rather than filtered here. Their data never
 * reaches the device, which is a stronger guarantee than any client-side filter.
 */
export function useDirectory() {
  const { data, error, loading, retry } = useCollection<DirectoryEntry>(
    () => query(collection(getDb(), COLLECTIONS.directory), where('eventId', '==', EVENT_ID)),
    [],
    (id, d) => ({ id, ...d }) as DirectoryEntry,
    (a, b) => a.name.localeCompare(b.name),
  );
  return { people: data, error, loading, retry };
}

/**
 * The single call site for attendee search.
 *
 * Every screen goes through this, so the implementation can change — to
 * Typesense, or to a server call — without touching a line of UI.
 */
export function searchAttendees(
  people: DirectoryEntry[],
  search: string,
  interest: string | null,
): DirectoryEntry[] {
  const needle = search.trim().toLowerCase();
  return people.filter((p) => {
    if (interest && !(p.interests ?? []).includes(interest)) return false;
    if (!needle) return true;
    return (
      p.name.toLowerCase().includes(needle) ||
      (p.company ?? '').toLowerCase().includes(needle) ||
      (p.title ?? '').toLowerCase().includes(needle)
    );
  });
}

/** Interests present in the directory, for the filter row. */
export function useInterests(people: DirectoryEntry[] | null): string[] {
  return useMemo(() => {
    if (!people) return [];
    const counts = new Map<string, number>();
    for (const p of people) {
      for (const i of p.interests ?? []) counts.set(i, (counts.get(i) ?? 0) + 1);
    }
    // Commonest first: a filter row nobody can reach the end of is a filter row
    // nobody uses.
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i);
  }, [people]);
}

export function useSpeakers() {
  const { data, error, loading, retry } = useCollection<Speaker>(
    () => query(collection(getDb(), COLLECTIONS.speakers), where('eventId', '==', EVENT_ID)),
    [],
    (id, d) => ({ id, ...d }) as Speaker,
    (a, b) => a.name.localeCompare(b.name),
  );
  return { speakers: data, error, loading, retry };
}

const TIER_ORDER = ['platinum', 'gold', 'silver', 'bronze'];

export function useSponsors() {
  const { data, error, loading, retry } = useCollection<Sponsor>(
    () => query(collection(getDb(), COLLECTIONS.sponsors), where('eventId', '==', EVENT_ID)),
    [],
    (id, d) => ({ id, ...d }) as Sponsor,
    // Tier order is a commercial commitment, not alphabetical.
    (a, b) =>
      TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
      a.name.localeCompare(b.name),
  );
  return { sponsors: data, error, loading, retry };
}

/**
 * Bookmarked attendees — Whova's star on a directory row.
 *
 * `users/{uid}/savedContacts/{contactUid}`, keyed by the person rather than an
 * auto id, so bookmarking twice is idempotent and "is this bookmarked?" is a set
 * membership test instead of a query. The model and the security rule for this
 * both already existed; only the seam was missing, which is why the star could
 * not be drawn.
 *
 * Private by construction: the rule permits only the owner to read or write the
 * subcollection, so who you bookmarked is not visible to the person bookmarked.
 */
export function useSavedContacts() {
  const { user } = useAuth();

  const { data, error } = useCollection<string>(
    () =>
      collection(
        getDb(),
        COLLECTIONS.users,
        user?.uid ?? '_',
        SUBCOLLECTIONS.savedContacts,
      ),
    [user?.uid],
    (id) => id,
  );

  const saved = useMemo(() => new Set(data ?? []), [data]);

  const toggle = useCallback(
    async (contactUid: string): Promise<WriteResult> => {
      if (!user) return { ok: false, error: new Error('Not signed in') };
      const ref = doc(
        getDb(),
        COLLECTIONS.users,
        user.uid,
        SUBCOLLECTIONS.savedContacts,
        contactUid,
      );
      return saved.has(contactUid)
        ? runWrite('remove bookmark', () => deleteDoc(ref))
        : runWrite('bookmark attendee', () =>
            setDoc(ref, { contactUid, savedAt: serverTimestamp() }),
          );
    },
    [user, saved],
  );

  return { saved, error, toggle, isSaved: (uid: string) => saved.has(uid) };
}

/** Initials for the avatar fallback. Storage may not be provisioned on Spark. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
