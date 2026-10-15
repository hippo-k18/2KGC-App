/**
 * What the two unsubscribe paths answer, apart from Firestore so it can be
 * tested.
 *
 * ⚠️ A failed write is a failure (T258 #11). The one-click POST used to answer
 * 204 whatever happened, and a mail client shows the reader nothing but that
 * answer: "Unsubscribed", while the contact stayed on every list. A 5xx makes
 * Gmail and Apple Mail report the failure and offer the button again, which is
 * the truth.
 */
export type UnsubscribeOutcome = 'unsubscribed' | 'already' | 'gone';

/** The HTTP status for the RFC 8058 one-click POST. */
export function oneClickStatus(result: UnsubscribeOutcome | 'error'): number {
  // RFC 8058 asks for a 2xx with no body. A contact that no longer exists is
  // on no audience, so the reader's intent already holds.
  return result === 'error' ? 503 : 204;
}

/** Where the `/u/{token}` button lands after pressing it. */
export function pageAfter(token: string, result: UnsubscribeOutcome | 'error'): string {
  return `/u/${encodeURIComponent(token)}?${result === 'error' ? 'error=1' : 'done=1'}`;
}
