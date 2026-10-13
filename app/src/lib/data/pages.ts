import { collection, query, where } from 'firebase/firestore';

import { COLLECTIONS, EVENT_ID, comparePages, type PageDoc, type WithId } from '@kgc/shared';

import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';

export type ContentPage = WithId<PageDoc>;

/**
 * The organizer's own pages — the Wi-Fi note, travel directions, the FAQ.
 *
 * ## The filter is what makes the read permitted, not what tidies it
 *
 * `firestore.rules` serves a page only when `published` is `true`, and a `list`
 * is judged on what the query could return rather than on the rows that come
 * back. So dropping the second equality below does not show drafts; it denies
 * the whole query and the screen renders its error state. That is the same
 * arrangement `useDocuments` and `useSurveys` have, and the rules suite pins
 * this exact query shape.
 *
 * ## Why every page is loaded at once
 *
 * There are a handful of them and each is a few hundred words, so the whole set
 * costs less than one session's Q&A thread. The reader screen picks its page
 * out of this list by slug rather than opening a second listener for one
 * document: it is already on screen by the time the row is tapped, so the page
 * opens with no spinner at all.
 *
 * ## Ordering, and the field that must not be in the query
 *
 * `order` is sorted in memory. A document written without the field is absent
 * from the index entirely, so ordering by it in Firestore would silently drop a
 * page rather than sorting it last — the reasoning `documents.ts` spells out,
 * and the same reason `apps/web` sorts the same set in Node.
 */
export function usePages() {
  const { data, error, loading, status, retry } = useCollection<ContentPage>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.pages),
        where('eventId', '==', EVENT_ID),
        where('published', '==', true),
      ),
    [],
    (id, d) => ({ id, ...d }) as ContentPage,
    // `comparePages` from `@kgc/shared`, so the phone, the website and the
    // dashboard cannot disagree about what order the organizer chose.
    comparePages,
  );
  return { pages: data, error, loading, status, retry };
}

/**
 * Whether a page is worth putting a row in front of somebody.
 *
 * A page with no title has nothing to tap and a page with no body opens onto
 * nothing. Both are states an organizer can produce, and both are better left
 * out than rendered as an empty screen — the dashboard shows them the same page
 * and is where it can be fixed.
 */
export function readable(p: ContentPage): boolean {
  return Boolean(p.title) && typeof p.body === 'string' && p.body.trim().length > 0;
}
