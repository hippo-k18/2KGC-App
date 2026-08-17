import { getFirebaseAuth } from '@/lib/firebase/client';

/**
 * What a listener is currently doing. `error` and `ready` are separate answers
 * and must never be collapsed into one.
 *
 * They were. `useCollection` used to report a failed listener as `data: []`, and
 * every screen renders `[]` as "there is genuinely nothing here" — so a
 * `permission-denied` on the sessions query produced "No sessions yet", a denied
 * directory produced "Nobody here yet", and a denied board invited the attendee
 * to start the first topic. The app looked finished, empty and working. Nobody
 * reports that; they walk to the registration desk, and the organizer gets no
 * signal either.
 *
 * It lives here rather than in `use-collection.ts` so that the document hook can
 * share it without importing the collection hook.
 */
export type DataStatus = 'loading' | 'ready' | 'error';

/**
 * Why a Firestore read failed, in the only categories that lead to different
 * advice.
 *
 * The distinction is the whole point. Every one of these used to arrive at a
 * screen as `data: []`, which renders identically to "there is genuinely nothing
 * here" — so an attendee whose token predates their registration saw a plausible
 * empty conference and queued at the registration desk instead of reporting a
 * bug. But telling them all to sign out again is barely better: a `unavailable`
 * on venue wifi fixes itself, and sending someone to the help desk for a network
 * blip is the same failure with the sign reversed.
 *
 * - `denied` — `permission-denied`. The rules said no. In this app that almost
 *   always means the `registered` custom claim is missing from the ID token,
 *   because claims are written into the token at sign-in and can lag the
 *   registration by up to an hour. Recoverable by the attendee.
 * - `signed-out` — `unauthenticated`. No credential at all.
 * - `offline` — `unavailable` / `deadline-exceeded`. The request never reached
 *   the server. Fixes itself; needs no action and no help desk.
 * - `misconfigured` — `failed-precondition` / `invalid-argument`. The query
 *   itself was rejected, which here means a composite index is missing (the
 *   emulator does not enforce them, so this class of bug reaches production
 *   only — see AGENTS.md). Nothing an attendee can do, and retrying is a lie.
 * - `unknown` — anything else, reported as itself rather than dressed up.
 */
export type FailureKind = 'denied' | 'signed-out' | 'offline' | 'misconfigured' | 'unknown';

/** The Firestore error code, or `''` for anything that is not one. */
export function failureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : '';
}

export function failureKind(error: unknown): FailureKind {
  // `FirestoreError.code` is unprefixed (`permission-denied`); auth errors are
  // `auth/...`, and one of them can reach a listener via a dead credential.
  switch (failureCode(error).replace(/^auth\//, '')) {
    case 'permission-denied':
      return 'denied';
    case 'unauthenticated':
    case 'user-token-expired':
      return 'signed-out';
    case 'unavailable':
    case 'deadline-exceeded':
    case 'network-request-failed':
      return 'offline';
    case 'failed-precondition':
    case 'invalid-argument':
      return 'misconfigured';
    default:
      return 'unknown';
  }
}

/** True when retrying the same listener could plausibly succeed. */
export function isRetryable(error: unknown): boolean {
  return failureKind(error) !== 'misconfigured';
}

/**
 * One retry that revives every listener on a screen.
 *
 * A `permission-denied` terminates each listener independently, so a screen
 * holding three of them has three dead streams and one visible error. Retrying
 * only the one the error came from leaves the others dead — measured: refreshing
 * the agenda brought the programme back and left the "Add to Agenda" controls
 * still reading unsaved, with a second banner underneath to clear. One cause,
 * one button.
 */
export function retryAll(...retries: (() => void)[]): () => void {
  return () => retries.forEach((r) => r());
}

/**
 * Pulls a fresh ID token before a listener is resubscribed.
 *
 * This is what makes the retry button on a `permission-denied` more than
 * decoration. Custom claims are baked into the ID token when it is minted, so a
 * client that signed in before its ticket was registered holds a token with no
 * `registered` claim and will keep being denied for as long as that token lives
 * — up to an hour — no matter how many times the query is repeated.
 * `getIdToken(true)` discards it and fetches a new one from the server, which
 * carries whatever claims exist now.
 *
 * Failures are swallowed on purpose: this runs on the way to a retry that is
 * itself already handling the error path, and a rejected refresh must not stop
 * the resubscribe from happening.
 */
export async function refreshCredentials(): Promise<void> {
  try {
    const user = getFirebaseAuth().currentUser;
    if (user) await user.getIdToken(true);
  } catch (e) {
    console.warn('[firestore] token refresh failed:', (e as Error).message);
  }
}
