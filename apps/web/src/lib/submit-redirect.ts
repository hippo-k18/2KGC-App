/**
 * Where `/submit` goes (T372): the call with "Show on website" on, or this
 * year's call when none is shown, with the visitor's query (UTMs) kept.
 */
export const FALLBACK_CALL_ID = 'call-for-speakers-kgc-2027';

export function submitTarget(shownCallId: string | null | undefined, search: string): string {
  const id = shownCallId || FALLBACK_CALL_ID;
  const q = search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : '';
  return `/submit/${encodeURIComponent(id)}${q}`;
}
