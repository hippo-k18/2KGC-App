import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { collection, getCountFromServer } from 'firebase/firestore';

import { getDb } from '@/lib/firebase/client';

export type Counts = Record<string, number> | null;

export interface CountsResult {
  /**
   * `null` until the first count lands, and an id is absent rather than zero
   * when its own count failed. Both cases mean "not counted", which callers must
   * render as nothing rather than as a confident zero — a zero next to eleven
   * visible replies is a specific claim, and it is false.
   */
  counts: Counts;
  /**
   * Applies the effect of the reader's *own* write before the server confirms
   * it — `+1` on an upvote, `-1` on taking it back. Only ever called with a
   * delta the caller has just successfully written, so it is not a guess.
   */
  adjust: (id: string, delta: number) => void;
}

/**
 * Counts a subcollection per parent document, on the server, because the
 * denormalised counter on the parent does not move.
 *
 * `replyCount`, `reactionCount` and `upvoteCount` are all owned by Cloud
 * Function triggers that are written, tested and **not deployed** — the project
 * is on Spark. Every one of them therefore holds whatever the seed wrote. Three
 * screens rendered those fields, and two of them also *sorted* by them, so the
 * numbers were wrong and the ordering they implied was wrong with them.
 *
 * A `count()` aggregation is the fix that needs no server: exact, billed at one
 * read per thousand index entries rather than one per document, and available on
 * Spark today. The cost is one round trip per parent — bounded by the page size
 * at every call site — which is why this is a stopgap. When the triggers land,
 * each caller can go back to reading its field; this file is then dead and
 * should be deleted rather than left as a second source of truth.
 *
 * Extracted rather than copied a third time. `community.ts` had the only
 * instance, for replies, and applying it to upvotes and reactions by hand would
 * have put three copies of the ordering below in three files.
 *
 * ## Ordering, which is the part that is easy to get wrong
 *
 * A recount and a local `adjust` can be in flight at the same time: the count
 * query is issued at T, the reader taps at T+1, and the response arrives at T+2
 * carrying a number that predates the tap. Applying it verbatim makes the
 * upvote the reader just cast visibly disappear. So deltas that arrive while a
 * count is outstanding are held and re-applied to the response. Deltas from
 * before it are dropped, because a count issued after the write acknowledged is
 * strongly consistent and already includes them.
 */
export function useSubcollectionCounts(
  ids: string[] | null,
  /** Absolute path segments to one parent's subcollection. */
  pathFor: (id: string) => string[],
  deps: unknown[] = [],
): CountsResult {
  const [counts, setCounts] = useState<Counts>(null);
  const [nonce, setNonce] = useState(0);
  const pending = useRef<Record<string, number>>({});

  // A one-shot read, not a listener: nothing about writing a reply or an upvote
  // touches the parent document, so no subscription anywhere would ever fire to
  // refresh this. Returning to the screen is the moment that has to recount.
  useFocusEffect(useCallback(() => setNonce((n) => n + 1), []));

  // Keyed on the ids, not the array. Every collection hook hands back a fresh
  // array on every snapshot, so depending on the array itself recounts the whole
  // page each time anyone touches anything on it.
  const key = ids?.join(',') ?? '';
  const pathRef = useRef(pathFor);
  pathRef.current = pathFor;

  useEffect(() => {
    if (!key) {
      setCounts(null);
      return;
    }
    const list = key.split(',');
    pending.current = {};
    let live = true;
    (async () => {
      const settled = await Promise.all(
        list.map(async (id) => {
          try {
            const snap = await getCountFromServer(
              collection(getDb(), pathRef.current(id).join('/')),
            );
            return [id, snap.data().count] as const;
          } catch {
            // One unreadable parent must not blank the counts for the other 49.
            return null;
          }
        }),
      );
      if (!live) return;
      const fresh = Object.fromEntries(settled.filter((e) => e !== null));
      for (const [id, delta] of Object.entries(pending.current)) {
        if (id in fresh) fresh[id] = Math.max(0, fresh[id] + delta);
      }
      pending.current = {};
      setCounts(fresh);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, ...deps]);

  const adjust = useCallback((id: string, delta: number) => {
    pending.current[id] = (pending.current[id] ?? 0) + delta;
    setCounts((prev) => {
      // Nothing counted yet: there is no number to move, and inventing one from
      // a single delta would claim a total nobody has read.
      if (!prev || !(id in prev)) return prev;
      return { ...prev, [id]: Math.max(0, prev[id] + delta) };
    });
  }, []);

  return { counts, adjust };
}
