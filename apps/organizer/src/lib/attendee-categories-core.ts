import { ticketKey, type AttendeeCategoryDef } from '@kgc/shared';
import type { AttendeeRow } from './attendees-core';

/**
 * The decisions behind the category screens, with no Firestore handle.
 *
 * The list itself, the ticket rule and every edit to either are in
 * `@kgc/shared` (`attendee-categories.ts`), because `ensureRegistration` needs
 * them too. What is here is what only the dashboard does with them: filter a
 * list, count it, and work out who a saved rule should relabel.
 */

/** The `?category=` value for people who have none. Not a legal category id. */
export const UNCATEGORISED = '(none)';

/** Whether a row belongs under a `?category=` filter. No filter matches everyone. */
export function inCategory(row: Pick<AttendeeRow, 'categoryId'>, filter: string | undefined): boolean {
  if (!filter) return true;
  return filter === UNCATEGORISED ? !row.categoryId : row.categoryId === filter;
}

/**
 * What to print for a row. The list's current name wins over the copy on the
 * registration, so a rename shows at once even on a row the rewrite missed.
 */
export function categoryLabel(
  categories: readonly AttendeeCategoryDef[],
  row: Pick<AttendeeRow, 'categoryId' | 'category'>,
): string {
  if (!row.categoryId) return '';
  return categories.find((c) => c.id === row.categoryId)?.name ?? row.category ?? '';
}

/** People per category id, in list order, then the people with none. */
export function categoryCounts(
  categories: readonly AttendeeCategoryDef[],
  rows: readonly Pick<AttendeeRow, 'categoryId'>[],
): { counts: Record<string, number>; uncategorised: number } {
  const counts: Record<string, number> = Object.fromEntries(categories.map((c) => [c.id, 0]));
  let uncategorised = 0;
  for (const r of rows) {
    if (r.categoryId && r.categoryId in counts) counts[r.categoryId] += 1;
    else uncategorised += 1;
  }
  return { counts, uncategorised };
}

/** The slice of a registration a rule looks at. */
export interface RuleTarget {
  id: string;
  ticketType?: string;
  status?: string;
  categoryId?: string;
  categorySource?: string;
}

/**
 * Who a newly saved ticket rule should relabel among the people already
 * registered: active holders of that ticket type whose category was not set by
 * hand and is not already the one the rule names.
 */
export function holdersToRelabel(
  registrations: readonly RuleTarget[],
  ticketType: string,
  categoryId: string,
): string[] {
  const key = ticketKey(ticketType);
  return registrations
    .filter(
      (r) =>
        r.status === 'active' &&
        ticketKey(r.ticketType) === key &&
        r.categorySource !== 'manual' &&
        r.categoryId !== categoryId,
    )
    .map((r) => r.id);
}

/**
 * Who a cleared rule should unlabel: the people it labelled. Somebody given the
 * same category by hand keeps it.
 */
export function holdersToUnlabel(
  registrations: readonly RuleTarget[],
  ticketType: string,
  categoryId: string,
): string[] {
  const key = ticketKey(ticketType);
  return registrations
    .filter(
      (r) => ticketKey(r.ticketType) === key && r.categorySource === 'ticket' && r.categoryId === categoryId,
    )
    .map((r) => r.id);
}
