import 'server-only';

import { COLLECTIONS, EVENT_ID, type ExhibitorDoc, type WithId } from '@kgc/shared';
import { db } from './firestore';

/**
 * Exhibitors — the exhibition hall, as distinct from sponsorship.
 *
 * ── Why this is not `sponsors` with a flag ──────────────────────────────────
 *
 * The two overlap enough that merging them is tempting and wrong. A sponsor
 * buys visibility: a tier, a logo on the website, a banner in the app. An
 * exhibitor buys floor space: a booth number, staff passes, and somewhere to
 * scan leads. Whova sells them as separate products with separate ticket
 * catalogues and separate messaging, and the fields barely intersect — a
 * `tier` means nothing to an exhibitor and a `boothNumber` means nothing to a
 * sponsor who is not in the hall.
 *
 * A company can of course be both. That is two records, which is correct: they
 * bought two things.
 *
 * ── Passes are the number that causes arguments ─────────────────────────────
 *
 * `passesAllocated` is what the package includes and `passesUsed` is what has
 * been claimed. On the morning of day one somebody from a booth will arrive
 * expecting a badge that was never allocated, and the only useful thing this
 * screen can do is have the number visible before that.
 */

export interface ExhibitorRow {
  id: string;
  name: string;
  boothNumber: string;
  contactName: string;
  contactEmail: string;
  website: string;
  description: string;
  status: ExhibitorDoc['status'];
  logoURL?: string;
  passesAllocated?: number;
  passesUsed: number;
  /** True when more passes have been claimed than the package allows. */
  overAllocated: boolean;
  createdAt: string;
}

function iso(t: { toDate(): Date } | undefined): string {
  try {
    return t?.toDate().toISOString() ?? new Date(0).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function toRow(id: string, e: ExhibitorDoc): ExhibitorRow {
  const used = e.passesUsed ?? 0;
  return {
    id,
    name: e.name,
    boothNumber: e.boothNumber ?? '',
    contactName: e.contactName ?? '',
    contactEmail: e.contactEmail ?? '',
    website: e.website ?? '',
    description: e.description ?? '',
    status: e.status ?? 'provisional',
    logoURL: e.logoURL,
    passesAllocated: e.passesAllocated,
    passesUsed: used,
    overAllocated: typeof e.passesAllocated === 'number' && used > e.passesAllocated,
    createdAt: iso(e.createdAt),
  };
}

/**
 * Every exhibitor, cancelled ones included.
 *
 * One equality filter on `eventId`, sorted in memory — the rule everywhere in
 * this app. The emulator does not enforce composite indexes, so a `where` plus
 * an `orderBy` passes locally and fails in production with
 * `failed-precondition`; that bug has shipped twice on this project.
 *
 * Cancelled exhibitors are returned rather than filtered here, because the
 * screen needs to count them and a caller that wants them gone can say so. A
 * data function that silently hides rows is a function whose totals never add
 * up on screen.
 */
export async function listExhibitors(): Promise<ExhibitorRow[]> {
  const snap = await db().collection(COLLECTIONS.exhibitors).where('eventId', '==', EVENT_ID).get();
  return snap.docs
    .map((d) => toRow(d.id, d.data() as ExhibitorDoc))
    .sort(
      (a, b) =>
        // Booth order is how the hall is walked, so it beats alphabetical for
        // anyone holding a floor plan. Unbooked exhibitors sort to the end.
        (a.boothNumber || '￿').localeCompare(b.boothNumber || '￿', undefined, {
          numeric: true,
        }) || a.name.localeCompare(b.name),
    );
}

export async function getExhibitor(id: string): Promise<WithId<ExhibitorDoc> | null> {
  const doc = await db().collection(COLLECTIONS.exhibitors).doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() as ExhibitorDoc;
  if (data.eventId !== EVENT_ID) return null;
  return { id: doc.id, ...data };
}

export interface ExhibitorSummary {
  total: number;
  confirmed: number;
  provisional: number;
  cancelled: number;
  withoutBooth: number;
  withoutContact: number;
  passesAllocated: number;
  passesUsed: number;
  overAllocated: number;
}

export async function exhibitorSummary(): Promise<ExhibitorSummary> {
  const rows = await listExhibitors();
  const live = rows.filter((r) => r.status !== 'cancelled');
  return {
    total: rows.length,
    confirmed: rows.filter((r) => r.status === 'confirmed').length,
    provisional: rows.filter((r) => r.status === 'provisional').length,
    cancelled: rows.filter((r) => r.status === 'cancelled').length,
    withoutBooth: live.filter((r) => !r.boothNumber).length,
    withoutContact: live.filter((r) => !r.contactEmail).length,
    passesAllocated: live.reduce((n, r) => n + (r.passesAllocated ?? 0), 0),
    passesUsed: live.reduce((n, r) => n + r.passesUsed, 0),
    overAllocated: live.filter((r) => r.overAllocated).length,
  };
}
