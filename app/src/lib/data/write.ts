/**
 * The result of a client write.
 *
 * Every write helper in this folder returns one of these instead of throwing.
 * Screens call them straight out of an `onPress`, where a rejected promise that
 * nobody awaited is an unhandled rejection — a red box in development and
 * silence in production, in both cases with the attendee left believing their
 * post, reply or reaction went through. A returned error can be shown; an
 * uncaught one cannot.
 *
 * Errors are returned, never swallowed: `runWrite` logs and hands the error
 * back so a caller that cares can react, and a caller that does not is still
 * safe.
 */
export interface WriteResult {
  ok: boolean;
  error: Error | null;
}

export async function runWrite(label: string, op: () => Promise<unknown>): Promise<WriteResult> {
  try {
    await op();
    return { ok: true, error: null };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.warn(`[firestore] ${label} failed:`, error.message);
    return { ok: false, error };
  }
}

/**
 * A write whose acknowledgement the caller deliberately does not wait for.
 *
 * Firestore resolves a write promise only when the server acknowledges it, so
 * awaiting one on conference wifi can block a UI action for seconds and, with
 * no network at all, forever — even though the mutation is already queued and
 * visible locally. Detaching keeps the failure observable rather than making it
 * an unhandled rejection.
 */
export function detachWrite(label: string, promise: Promise<unknown>): void {
  promise.catch((e: unknown) => {
    const error = e instanceof Error ? e : new Error(String(e));
    console.warn(`[firestore] ${label} failed:`, error.message);
  });
}
