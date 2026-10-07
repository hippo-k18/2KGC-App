/**
 * The bookkeeping behind acquiring `users/{uid}.registrationId`, kept away from
 * the hook so it can be tested.
 *
 * There is one decision here and it is the one that was wrong: **a write is
 * remembered when it succeeds, not when it is attempted.** The old version set
 * its guard before the write went out, so a single failure — a token that had
 * not picked up the `registered` claim, a phone still joining the wifi — was
 * remembered as "done" for the life of that mount, and the account stayed
 * unrecognisable until the app was restarted. The person's video stayed locked
 * and nothing on screen had a reason for it.
 *
 * The opposite mistake is a retry loop against the rules, which this repo
 * refuses elsewhere for good reason: an account that genuinely holds no ticket
 * would hammer a refusal for ever. So failures are counted and they run out.
 *
 * No React, no Firestore. Tested in `registration-pointer-core.test.ts`.
 */

/** Attempts before it gives up until something else asks it to try again. */
export const POINTER_ATTEMPTS = 3;

/** Spacing between attempts. Long enough for a token refresh to land. */
export const POINTER_RETRY_MS = 5_000;

/** What the hook carries between renders. */
export interface PointerMemory {
  /** The `uid:registrationId` pair that has actually been stored. */
  written: string | null;
  /** Failed attempts since the last success. */
  attempt: number;
}

export const NO_POINTER_MEMORY: PointerMemory = { written: null, attempt: 0 };

/** The key one account-and-registration pair is remembered under. */
export function pointerKey(uid: string, registrationId: string): string {
  return `${uid}:${registrationId}`;
}

/**
 * Is there a lookup to make at all?
 *
 * False for the ordinary case — an account that already carries a pointer —
 * which is what keeps this free for everybody after their first run.
 */
export function pointerWanted(input: {
  uid: string | undefined;
  address: string | null;
  settled: boolean;
  pointer: string | null | undefined;
}): boolean {
  const have = typeof input.pointer === 'string' && input.pointer.length > 0;
  return Boolean(input.uid) && Boolean(input.address) && input.settled && !have;
}

/** Is this write still owed, given what has already landed? */
export function pointerWriteDue(memory: PointerMemory, key: string | null): boolean {
  return Boolean(key) && memory.written !== key;
}

/** After a failure, is another attempt owed, or has it run out? */
export function pointerRetryDue(
  memory: PointerMemory,
  limit: number = POINTER_ATTEMPTS,
): boolean {
  return memory.attempt + 1 < limit;
}

/**
 * What to remember after an attempt.
 *
 * ⚠️ The key is recorded only when `ok`. Recording it on the attempt is the bug
 * this file exists to describe.
 */
export function nextPointerMemory(
  memory: PointerMemory,
  key: string,
  ok: boolean,
): PointerMemory {
  if (ok) return { written: key, attempt: 0 };
  return { written: memory.written, attempt: memory.attempt + 1 };
}
