import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  doc,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

import {
  COLLECTIONS,
  DOOR_CHECK_IN_LIST_ID,
  SUBCOLLECTIONS,
  type CheckInDoc,
  type RegistrationDoc,
} from '@kgc/shared';

import { useAuth } from '@/lib/auth/auth-provider';
import { useCollection } from '@/lib/data/use-collection';
import { useDocument } from '@/lib/data/use-document';
import { detachWrite } from '@/lib/data/write';
import { getDb } from '@/lib/firebase/client';

/**
 * The attendee's badge: what goes in the QR, and where it comes from.
 *
 * =========================================================================
 * WHAT THE QR CONTAINS, AND WHY
 * =========================================================================
 *
 * **The payload is the registration's `qrSecret`, on its own, and nothing else.**
 * No email, no uid, no `registrationId`, no envelope, no JSON.
 *
 * `qrSecret` is 24 bytes from a CSPRNG rendered as base64url — 192 bits, minted
 * once at registration by `scripts/src/lib/ids.ts` and never derived from
 * anything about the person. That property is the point:
 *
 *   · **An email would be an identity leak.** A badge is held up in a crowded
 *     hall and photographed from three metres away all week. Anyone with a
 *     long lens would harvest a thousand addresses and the conference would have
 *     shipped a lead-scraping tool.
 *   · **A `registrationId` would be worse than it looks.** It is
 *     `reg_` + sha256(email) — see `apps/web/src/lib/order-token.ts`, which
 *     exists because of exactly this — so it is *computable from an address*. It
 *     is not a secret; it is a slow spelling of the email.
 *   · **A uid would join the badge to everything else.** The uid keys the
 *     profile, the messages, the saved sessions. One photograph should not be a
 *     handle on all of it.
 *
 * A short-lived signed token was the serious alternative, and it was rejected
 * deliberately rather than overlooked:
 *
 *   · Verifying a signature needs a key at the door. A key shipped in the app
 *     bundle is not a secret — it is in every attendee's hands. A per-attendee
 *     key is `qrSecret` again, so the honest version of "short-lived token" is
 *     TOTP keyed on `qrSecret`.
 *   · TOTP requires the phone's clock and the scanner's clock to agree **while
 *     both are offline**, which is the situation the badge exists for. A badge
 *     that refuses because a phone is ninety seconds out, in a queue, at 08:55,
 *     is a worse outcome than the attack it prevents.
 *   · Any offline verifier must accept a skew window, and the skew window *is*
 *     the replay window. A design whose only control is short life, and which
 *     must then widen that life to work, has bought less than it appears to.
 *
 * So: the offline requirement and the replay requirement are in genuine tension,
 * and this resolves in favour of offline.
 *
 * -------------------------------------------------------------------------
 * THE THREAT THIS ACCEPTS, STATED PLAINLY
 * -------------------------------------------------------------------------
 *
 * **`qrSecret` is a long-lived bearer credential for attendance.** Anyone who
 * photographs this screen, or shoulder-surfs the QR, can present it at the door
 * and be checked in as that attendee. That is accepted. What bounds it:
 *
 *   1. **It grants attendance and nothing else.** It is not a sign-in
 *      credential. Holding a `qrSecret` gives no read of the profile, the
 *      directory, the messages or the ticket. The sign-in fallback printed on a
 *      badge is `claimCode`, a deliberately separate and lower-stakes value, and
 *      it is never in the QR.
 *   2. **The theft is detected, not silent.** `checkIns` is keyed by
 *      registration, so when the real attendee arrives their scan is a duplicate
 *      and the desk reads "already checked in at 09:12 at Front desk 1". The
 *      first scan is preserved and `scanEvents` records the device that made it.
 *      A stolen badge produces evidence at the moment it costs somebody
 *      something.
 *   3. **It is revocable.** Rotating `qrSecret` on the registration invalidates
 *      every photograph of it at once, and no client may rotate it — the
 *      `registrations` update rule allows `claimedByUid` and nothing more — so
 *      revocation is an organizer action taken with the Admin SDK.
 *   4. **It is unguessable and unenumerable.** 192 random bits, not derived, so
 *      there is no offline search and no way to walk the guest list.
 *
 * What is *not* accepted, and is closed in `firestore.rules`: identity
 * disclosure, enumeration of the ticket list, and self-check-in.
 *
 * =========================================================================
 * WHY THE BADGE IS CACHED ON THE DEVICE
 * =========================================================================
 *
 * The badge has to work in a basement with no signal. AGENTS.md is explicit that
 * offline does not work in this app — the Firebase JS SDK has no disk
 * persistence on React Native, so its cache is memory-only and a cold start with
 * no network renders nothing. That is fine for the agenda and fatal for a badge.
 *
 * So the four fields the badge needs are written to `AsyncStorage` whenever a
 * live read succeeds, and read back on mount before any listener is attached.
 * This is a deliberately tiny, badge-only workaround, not the beginning of an
 * offline layer: the general fix is the `@react-native-firebase` migration.
 *
 * `checkedInAt` is deliberately NOT cached. Attendance is a fact about the
 * world that changes without the phone's involvement, and a badge that says
 * "checked in" from a stale cache is the app claiming something it does not
 * know. When the status cannot be read, the screen says so.
 */

/** What the badge screen needs, and the exact set that is cached. */
export interface Badge {
  registrationId: string;
  /** The QR payload. See the note above — this is the whole payload. */
  qrSecret: string;
  name: string;
  ticketType: string | null;
  /** Printed on the badge as the human fallback when a screen or reader fails. */
  claimCode: string | null;
  status: RegistrationDoc['status'];
}

/** Where the badge on screen came from, so the UI never has to guess. */
export type BadgeSource = 'live' | 'cache' | 'none';

const CACHE_VERSION = 'v1';

/**
 * Keyed by uid, not by a single global key. Two attendees sharing a device —
 * which happens, with a colleague's phone at a registration desk — must not see
 * each other's badge, and signing out must not leave one behind for the next
 * person to sign in.
 */
const cacheKey = (uid: string) => `kgc.badge.${CACHE_VERSION}.${uid}`;

function isBadge(value: unknown): value is Badge {
  const b = value as Badge | null;
  return Boolean(
    b &&
      typeof b.registrationId === 'string' &&
      typeof b.qrSecret === 'string' &&
      b.qrSecret.length > 0 &&
      typeof b.name === 'string',
  );
}

export interface BadgeResult {
  badge: Badge | null;
  source: BadgeSource;
  /** True until either the cache or the first live answer has settled. */
  loading: boolean;
  /**
   * Set when the registration lookup failed. Absent-but-settled is not an error
   * — it means this account holds no ticket — and is reported as
   * `badge === null` with `source: 'none'`.
   */
  error: Error | null;
  retry: () => void;
}

/**
 * Deliberately built on the smallest surface `useCollection` and `useDocument`
 * expose — `data`, `error` and `loading` — and nothing wider.
 *
 * Both hooks are being extended by other work in this repo, and "settled and
 * absent" versus "could not read" is derivable from these three alone:
 * `!loading && !error` means the listener answered. Retry is done by bumping a
 * value in the dependency array, which is how a resubscribe already works, so
 * this module needs no resubscribe API of its own. The point is that the badge —
 * the one screen that has to work at a door — does not break when the shared
 * hooks change shape underneath it.
 */

/**
 * The signed-in attendee's registration, found by their own email address.
 *
 * ## Why a query and not `getDoc` on the derived id
 *
 * A direct `getDoc` would be strictly better: no `list` permission, no index, one
 * fewer round trip, and `registrations` would be genuinely unenumerable instead
 * of enumerable-but-filtered. This repo has already made that exact move once,
 * replacing a `documentId() in [...]` query with direct `getDoc` calls on the
 * speaker path after the query form silently returned nothing.
 *
 * It is not available here. The id is `reg_` + sha256(email), and this client
 * cannot compute it: `node:crypto` does not exist in React Native, `expo-crypto`
 * is not a dependency of this app, and `registrationId()` lives in
 * `@kgc/scripts` behind a `node:crypto` import so it cannot be shared. Writing a
 * second implementation of the derivation in the app is precisely the duplicated
 * derivation this repo has been bitten by — and a badge that computes a *slightly*
 * different id finds no ticket, with no error to explain it.
 *
 * So the query stands, and the `list` rule is what makes it safe:
 * `registrationIsMine(resource.data)` is evaluated against every candidate
 * document, so a query filtered to somebody else's address is refused and an
 * unfiltered one is refused outright. If `expo-crypto` is ever added for another
 * reason, this should become a `getDoc` and the `list` rule should go with it.
 *
 * ## Why `email` and not `emailHash`
 *
 * `apps/web/src/lib/registrations.ts` and the declared composite index both key
 * on `emailHash`, and two lookup keys for one identity is how they drift. This
 * path uses the raw address for two reasons: the app cannot compute `emailHash`
 * either, for the same missing-hash reason above; and more importantly the
 * *authorization rule* compares `data.email.lower()`, so `email` is the key the
 * security boundary already uses. Filtering on `emailHash` while the rule checks
 * `email` would be the real drift — a query and a rule keyed on different fields.
 *
 * Single-field equality, so it is served by Firestore's automatic index — there
 * is no composite index to add, and no `fieldOverrides` entry disables indexing
 * on `registrations.email`. Both matter, because the emulator enforces neither
 * and a missing index fails only in production.
 */
export function useBadge(): BadgeResult {
  const { user, loading: authLoading } = useAuth();
  const uid = user?.uid;
  const email = user?.email?.trim().toLowerCase() ?? null;

  const [cached, setCached] = useState<Badge | null>(null);
  const [cacheChecked, setCacheChecked] = useState(false);
  // Bumped by `retry`, and a dependency of the listener below, so retrying is an
  // ordinary resubscribe rather than a second code path that can drift.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Read the cache before the listener can answer, so a cold start with no
  // network shows a scannable badge rather than a spinner.
  useEffect(() => {
    let alive = true;
    setCached(null);
    setCacheChecked(false);
    if (!uid) {
      setCacheChecked(true);
      return;
    }
    void AsyncStorage.getItem(cacheKey(uid))
      .then((raw) => {
        if (!alive) return;
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (isBadge(parsed)) setCached(parsed);
        }
      })
      .catch((e: unknown) => {
        // A corrupt or unreadable cache is not worth surfacing: the live read is
        // about to overwrite it anyway.
        console.warn('[badge] could not read the cached badge:', (e as Error).message);
      })
      .finally(() => {
        if (alive) setCacheChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [uid]);

  const live = useCollection<Badge>(
    () =>
      query(
        collection(getDb(), COLLECTIONS.registrations),
        where('email', '==', email),
        // One ticket per address by construction — `registrationId(email)` is
        // the document id, so a second document for the same address cannot
        // exist. The limit is belt-and-braces against a hand-edited database.
        limit(1),
      ),
    // `attempt` is here so `retry()` resubscribes. See the note above on why
    // this module leans on the deps array rather than a hook-provided retry.
    [email, attempt],
    (id, d: RegistrationDoc) => ({
      registrationId: id,
      qrSecret: d.qrSecret,
      name: d.name ?? d.email,
      ticketType: d.ticketType ?? null,
      claimCode: d.claimCode ?? null,
      status: d.status,
    }),
  );

  const liveBadge = live.data?.[0] ?? null;

  // Persist whatever last loaded. Written on every successful read rather than
  // only the first, so a rotated `qrSecret` or a changed ticket type reaches the
  // cache too — a stale badge secret is a badge that fails at the door.
  useEffect(() => {
    if (!uid || !liveBadge) return;
    void AsyncStorage.setItem(cacheKey(uid), JSON.stringify(liveBadge)).catch((e: unknown) => {
      console.warn('[badge] could not cache the badge:', (e as Error).message);
    });
  }, [uid, liveBadge]);

  // `!loading && !error` is "the listener answered", which is the only signal
  // needed and the only one guaranteed to survive the shared hooks changing shape.
  const liveSettled = !live.loading && !live.error;

  useClaimRegistration(uid, liveBadge?.registrationId, liveSettled);

  const badge = liveBadge ?? cached;
  const source: BadgeSource = liveBadge ? 'live' : badge ? 'cache' : 'none';

  return {
    badge,
    source,
    // Settled once the cache has been consulted AND the listener has either
    // answered or failed. A cached badge is shown immediately regardless.
    loading: (authLoading || !cacheChecked || live.loading) && !badge,
    error: live.error,
    retry,
  };
}

/**
 * Records that this account has picked up this registration.
 *
 * The console's attendee list shows who has actually reached the app, which is
 * the number an organizer wants in the week before the doors open, and nothing
 * else sets it: there is no Cloud Function to do it, because the project is on
 * Spark. The rules permit exactly this one field and require the uid to be the
 * caller's own.
 *
 * Detached rather than awaited. It is bookkeeping — the badge is already on
 * screen and does not depend on it — and awaiting a Firestore write on
 * conference wifi blocks for seconds, or forever with no network at all.
 */
function useClaimRegistration(
  uid: string | undefined,
  registrationId: string | undefined,
  settled: boolean,
) {
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!uid || !registrationId || !settled) return;
    // One attempt per pair. A refused write must not become a retry loop against
    // the rules, which is the shape `AuthProvider` already uses for the same
    // reason.
    const key = `${uid}:${registrationId}`;
    if (attempted.current === key) return;
    attempted.current = key;

    detachWrite(
      'claim registration',
      updateDoc(doc(getDb(), COLLECTIONS.registrations, registrationId), {
        claimedByUid: uid,
        updatedAt: serverTimestamp(),
      }),
    );
  }, [uid, registrationId, settled]);
}

export interface CheckInStatus {
  /** `null` once settled and absent — genuinely not checked in yet. */
  checkedInAt: Date | null;
  /** True only when the answer is known. False while loading or on failure. */
  known: boolean;
  loading: boolean;
  error: Error | null;
  retry: () => void;
}

/**
 * Whether this attendee has been checked in at the main door.
 *
 * Read straight from `checkInLists/{DOOR_CHECK_IN_LIST_ID}/checkIns/{registrationId}`,
 * which is the document the scanner writes. The list id is a constant in
 * `@kgc/shared` precisely so the app never has to enumerate the check-in lists —
 * and so the `checkInLists` read rule can stay organizer-only.
 *
 * `known` is separate from `checkedInAt` on purpose. "Not checked in" and "could
 * not find out" are different sentences and the screen says the second one out
 * loud rather than showing the first. This is never cached: attendance changes at
 * the door, without the phone, so a cached "checked in" would be the app
 * asserting something it cannot see.
 */
export function useCheckInStatus(registrationId: string | null | undefined): CheckInStatus {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const { data, error, loading } = useDocument<{ checkedInAt: Date | null }>(
    () =>
      registrationId
        ? doc(
            getDb(),
            COLLECTIONS.checkInLists,
            DOOR_CHECK_IN_LIST_ID,
            SUBCOLLECTIONS.checkIns,
            registrationId,
          )
        : null,
    [registrationId, attempt],
    (_id, d: CheckInDoc) => ({
      // `serverTimestamp()` is null in the local echo of a write and for a
      // moment after; the screen falls back to "checked in" without a time
      // rather than rendering "Invalid Date".
      checkedInAt: d.checkedInAt?.toDate ? d.checkedInAt.toDate() : null,
    }),
  );

  return {
    checkedInAt: data?.checkedInAt ?? null,
    // "The listener answered." A denial or a dropped connection leaves this
    // false, which is what makes the screen say "could not find out" instead of
    // the far worse "not checked in".
    known: Boolean(registrationId) && !loading && !error,
    loading,
    error,
    retry,
  };
}

/** Clear the cached badge. Called on sign-out so a shared device does not leak one. */
export async function forgetCachedBadge(uid: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(cacheKey(uid));
  } catch (e) {
    console.warn('[badge] could not clear the cached badge:', (e as Error).message);
  }
}

/** Re-exported so the badge screen does not spell the payload rule twice. */
export const badgePayload = (badge: Badge) => badge.qrSecret;

/** True when the QR is worth showing at all — a cancelled ticket is not. */
export const badgeIsScannable = (badge: Badge) => badge.status === 'active';
