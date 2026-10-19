import { useEffect, useRef, useState } from 'react';

import {
  claimRegistrationPointer,
  myAddress,
  registrationByAltEmail,
  registrationByEmail,
} from '@/lib/data/registrations';
import { useCollection } from '@/lib/data/use-collection';
import {
  NO_POINTER_MEMORY,
  POINTER_RETRY_MS,
  nextPointerMemory,
  pointerKey,
  pointerRetryDue,
  pointerWanted,
  pointerWriteDue,
  type PointerMemory,
} from '@/lib/data/registration-pointer-core';
import { runWrite } from '@/lib/data/write';
import { getDb } from '@/lib/firebase/client';

import type { RegistrationDoc } from '@kgc/shared';

/**
 * Making sure this account can be recognised as a ticket holder, from anywhere.
 *
 * ── The bug this exists to close ────────────────────────────────────────────
 *
 * `users/{uid}.registrationId` is what `firestore.rules` follows to learn which
 * ticket the caller holds. It used to be written by one hook on one screen, the
 * badge, which is reached from the Me tab. The app opens on Home. Install, sign
 * in, go to a session with a gated video: no pointer, the read is refused, and
 * the refusal is indistinguishable from holding the wrong ticket. Two more
 * routes reached the same place — a badge served from the device cache never
 * ran the effect at all, and a single failed write was remembered as "tried"
 * for the life of that mount, so it never went again.
 *
 * The seed stamps the pointer on all fifty-two demo accounts, which is why the
 * demo has always worked and why none of this was visible.
 *
 * So the pointer is acquired above every screen instead, from `AuthProvider`.
 *
 * ── Why it is a component and not a call in the provider body ───────────────
 *
 * `useCollection` reads the auth context to decide whether it may open a
 * listener at all. Called from inside `AuthProvider`'s own body it would read
 * the *default* context — no user, still loading — and hold in `loading`
 * forever without ever opening one. Measured, not assumed: the first version of
 * this did exactly that and wrote no pointer at all. So `RegistrationPointer`
 * renders as a child of the provider, where the context is the real one, and
 * takes what it needs as props.
 *
 * ── It costs nothing once it is there ───────────────────────────────────────
 *
 * The profile is already being read for the signed-in account, and it carries
 * the pointer. So this looks at that first and opens no query at all for the
 * ordinary case, which is somebody who already has one. Only an account
 * missing it pays for the lookup, and only once.
 *
 * ── Why a failure is retried, and why not for ever ──────────────────────────
 *
 * The write can fail for reasons that pass: no network on arrival, a token that
 * has not picked up the `registered` claim yet. Those deserve another go. It
 * can also fail for a reason that will never pass — an account that holds no
 * ticket — and a retry loop against the rules is the thing this repo already
 * refuses to write elsewhere. So it is a small fixed number of attempts, spaced
 * out, and then it stops. The counting and the "is this write still owed"
 * question live in `registration-pointer-core.ts`, where they can be tested:
 * the thing that was wrong is one line of bookkeeping, and bookkeeping nobody
 * can test is bookkeeping that goes wrong again.
 */

export interface PointerState {
  /** True once the profile carries a pointer, or one has just been written. */
  ready: boolean;
  /** Why it could not be stored, when it could not be. */
  error: Error | null;
}

/**
 * @param uid      the signed-in account, or undefined
 * @param email    the address on the token
 * @param pointer  `users/{uid}.registrationId` as last read
 * @param settled  false while the profile read is still out
 */
export function useRegistrationPointer(
  uid: string | undefined,
  email: string | null | undefined,
  pointer: string | null | undefined,
  settled: boolean,
): PointerState {
  const address = myAddress(email);
  const have = typeof pointer === 'string' && pointer.length > 0;

  // Nothing to do at all for an account that already has one, which is every
  // account after the first time it opens the app.
  const wanted = pointerWanted({ uid, address, settled, pointer });

  // Bumped after a failed attempt, and a dependency of the effect below, so a
  // retry is an ordinary re-run rather than a second code path.
  const [round, setRound] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const memory = useRef<PointerMemory>(NO_POINTER_MEMORY);

  const toId = (id: string, _d: RegistrationDoc) => id;

  const primary = useCollection<string>(
    () => (wanted && address ? registrationByEmail(getDb(), address) : null),
    [wanted, address, round],
    toId,
  );

  // A ticket bought on a work address and signed in on a personal one is the
  // ordinary case. Asked only once the primary has come back empty.
  const primaryEmpty = !primary.loading && !primary.error && primary.data?.length === 0;
  const alternate = useCollection<string>(
    () => (wanted && address && primaryEmpty ? registrationByAltEmail(getDb(), address) : null),
    [wanted, address, primaryEmpty, round],
    toId,
  );

  const registrationId = primary.data?.[0] ?? alternate.data?.[0] ?? null;

  useEffect(() => {
    if (!wanted || !uid || !registrationId) return;
    const key = pointerKey(uid, registrationId);
    if (!pointerWriteDue(memory.current, key)) return;

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    void runWrite('point profile at registration', () =>
      claimRegistrationPointer(getDb(), uid, registrationId),
    ).then((result) => {
      if (!alive) return;
      memory.current = nextPointerMemory(memory.current, key, result.ok);
      setError(result.error);
      // Another go, spaced out, until the count runs out.
      if (!result.ok && pointerRetryDue(memory.current)) {
        timer = setTimeout(() => setRound((n) => n + 1), POINTER_RETRY_MS);
      }
    });

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [wanted, uid, registrationId, round]);

  return { ready: have, error };
}

/**
 * Renders nothing. Mounted by `AuthProvider` inside its own context, which is
 * the whole point — see the note above on why this cannot be a plain call in
 * the provider's body.
 */
export function RegistrationPointer({
  uid,
  email,
  pointer,
  settled,
}: {
  uid: string | undefined;
  email: string | null | undefined;
  pointer: string | null | undefined;
  settled: boolean;
}): null {
  useRegistrationPointer(uid, email, pointer, settled);
  return null;
}
