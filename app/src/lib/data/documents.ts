import { collection, query, where } from 'firebase/firestore';

import { COLLECTIONS, EVENT_ID, type DocumentDoc, type WithId } from '@kgc/shared';

import { getDb } from '@/lib/firebase/client';
import { useCollection } from '@/lib/data/use-collection';

export type Handout = WithId<DocumentDoc>;

/**
 * The handouts an attendee may open — slide decks, datasets, the code of
 * conduct.
 *
 * ## Both filters are what make the read permitted, not what tidies it
 *
 * `firestore.rules` serves a document only when it is `published` **and** its
 * `visibleToTicketTypes` is empty, and a `list` is judged on what the query
 * could return rather than on the rows that come back. So dropping either
 * equality below does not widen this list; it denies the whole query and the
 * screen renders its error state. The rule block explains why the second one
 * exists at all: `visibleToTicketTypes` restricts a handout to holders of a
 * named ticket type, ticket tier is **not** a custom claim — `registered` and
 * `roles` are the only two — and rules filter documents rather than fields, so
 * there is no predicate that hands a restricted handout to the right readers.
 *
 * A restricted handout is therefore absent here rather than filtered out of
 * here, the same arrangement `directory/{uid}` and `exhibitorListings/{id}`
 * have. That matters more than the usual privacy argument: `url` points at a
 * file somebody else is hosting, and a link that reaches a device once cannot
 * be revoked. The dashboard's Documents screen says so beside the field.
 *
 * ⚠️ **This list is a subset of what the organizer sees, and nothing in the app
 * says a document is missing.** Naming the gap on screen would tell an attendee
 * that a file exists which they cannot have — which is neither actionable nor
 * true for most readers, since most handouts are unrestricted. The dashboard is
 * where that fact belongs and where it is stated.
 *
 * ## The index, and why it stops at three fields
 *
 * `eventId, status, visibleToTicketTypes` in `firestore.indexes.json`, with
 * `eventId` leading as every index here does. The emulator enforces neither
 * composite indexes nor their absence, so this query passes every local run and
 * would fail live with `failed-precondition` without that entry.
 *
 * Ordering is done below rather than in the query, and deliberately: a document
 * missing an indexed field is not in the index at all, so adding `order` to it
 * would silently drop any handout written without one from the list rather than
 * merely sorting it last. `apps/web` sorts the same set in memory for the same
 * reason. `order` is the organizer's own sequence from the dashboard; title
 * breaks the ties it leaves.
 */
export function useDocuments() {
  const { data, error, loading, status, retry } = useCollection<Handout>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.documents),
        where('eventId', '==', EVENT_ID),
        where('status', '==', 'published'),
        // The empty array is a value, not a placeholder — `== []` is an
        // equality on the whole field, and it is half of what makes the `list`
        // legal. `tests/rules/firestore.test.ts` pins this exact query shape.
        where('visibleToTicketTypes', '==', []),
      ),
    [],
    (id, d) => ({ id, ...d }) as Handout,
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title),
  );
  return { documents: data, error, loading, status, retry };
}

/**
 * The host a link points at, for the line under a handout's title.
 *
 * Printed because these are links off to somebody else's server and the reader
 * is entitled to know whose before they tap — the same reason the dashboard
 * prints it in its table. A malformed URL yields an empty string rather than
 * throwing; `openable()` below is what actually keeps that row from rendering.
 */
export function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Whether a handout is worth putting a tappable row in front of somebody.
 *
 * `Linking.openURL` on a malformed or non-http address rejects, and an
 * unhandled rejection from a press handler is a crash rather than a shrug. A
 * row that cannot open is also indistinguishable on screen from one that can,
 * so the honest thing is to leave it out — the organizer sees the same document
 * flagged as a broken link on the dashboard, which is where it can be fixed.
 *
 * `http` and `https` only. A `javascript:` or `file:` URL is not a document,
 * and this list is authored server-side but rendered on a thousand phones.
 */
export function openable(d: Handout): boolean {
  if (!d.title || typeof d.url !== 'string') return false;
  try {
    const scheme = new URL(d.url).protocol;
    return scheme === 'http:' || scheme === 'https:';
  } catch {
    return false;
  }
}

/** What the row calls a handout's kind. `link` says nothing useful, so it says nothing. */
export function kindLabel(kind: DocumentDoc['kind']): string {
  return kind === 'pdf' ? 'PDF' : kind === 'slides' ? 'Slides' : kind === 'video' ? 'Video' : '';
}
