import { createHash } from 'node:crypto';

import { COLLECTIONS } from '@kgc/shared';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';

/**
 * ── Why this file moved out of `functions/` ─────────────────────────────────
 *
 * The two OTP endpoints are now served from **two** hosts: the Cloud Functions
 * they were written for, and `apps/web` route handlers, because deploying
 * functions is blocked on an IAM grant only the owner can give
 * (OWNER-ACTIONS.md §3). Both hosts share one rate limiter, and they must —
 * two limiters over the same `rateLimits` collection with different window
 * arithmetic is a cap that is quietly twice what it says.
 *
 * `functions/src/lib/rate-limit.ts` re-exports this file. Nothing was forked.
 */

/**
 * Fixed-window counters, stored in `rateLimits` alongside the per-email OTP
 * counter that collection was created for.
 *
 * `rateLimits` is documented in `@kgc/shared` as server-only: written and read
 * by Cloud Functions with the Admin SDK, with no `match` block in
 * `firestore.rules` and therefore closed to every client. It now holds more
 * than one document shape, told apart by `kind` and by an id prefix — see
 * `ipCounterId` and the agenda-fan-out ids in `on-session-agenda-change.ts`.
 * The original per-email documents predate `kind` and do not carry it; nothing
 * reads across shapes, so that is fine.
 *
 * Every document written through here carries `expiresAt`, which exists solely
 * so a Firestore TTL policy can sweep the collection. Without one, `rateLimits`
 * grows by one document per distinct email and one per distinct IP, forever —
 * for an endpoint whose whole threat model is an attacker generating distinct
 * values. See `docs/deploy-functions.md` for the exact command that installs
 * the policy; the field is useless until it is run.
 */
export interface WindowCounterDoc {
  kind: string;
  count: number;
  windowStart: Timestamp;
  updatedAt: Timestamp;
  /** Read only by the Firestore TTL policy, never by this code. */
  expiresAt: Timestamp;
}

/**
 * The same document as it is **written**, with plain `Date`s where the read
 * shape has `Timestamp`s.
 *
 * ⚠️ This distinction is AGENTS.md gotcha 8 and it is not cosmetic. Three
 * copies of `firebase-admin` exist in this repo — `apps/web`, `apps/organizer`
 * and the root — and `Timestamp` is a **class** that Firestore validates with
 * `instanceof`. A `Timestamp` constructed inside `@kgc/scripts` resolves to the
 * root copy; handed to a store created in `apps/web`, it fails the whole write
 * with "Value for argument data is not a valid Firestore document". This module
 * runs under both, so it must never construct one.
 *
 * A native `Date` is a global. It converts on write under every copy, and comes
 * back as that store's own `Timestamp` on read.
 *
 * `windowStart` is the exception that is allowed to be either: when a window
 * continues, the value written back is the one just read *from that same
 * store*, so it is already that store's own class.
 */
export interface WindowCounterWrite {
  kind: string;
  count: number;
  /** A `Date` for a fresh window, or the read-back value for a continuing one. */
  windowStart: Date | Timestamp | { toMillis(): number };
  updatedAt: Date;
  expiresAt: Date;
}

/**
 * Milliseconds from a `Date` or from anything Timestamp-shaped.
 *
 * Structurally typed rather than taking `Timestamp`, because there are **three**
 * unrelated declarations of that name in play and a signature naming any one of
 * them rejects the other two: `firebase-admin`'s class, the copy of it under
 * `apps/web/node_modules`, and the type-only `Timestamp` interface in
 * `@kgc/shared`, which is what every document shape in this repo is declared
 * with. All three have `toMillis()`, which is the only thing this needs.
 */
export function toMillis(value: Date | { toMillis(): number }): number {
  return value instanceof Date ? value.getTime() : value.toMillis();
}

/**
 * Decides what a fixed window's counter becomes after one more request, or
 * `null` when that request is over the cap.
 *
 * Pure on purpose: the two callables run this inside their own Firestore
 * transactions, and a transaction body is the one place where a helper that
 * does its own IO would be a bug (a nested read after a queued write, or a
 * second transaction that cannot see the first). Keeping the arithmetic
 * separate also means the window edge is testable without an emulator.
 */
export function tickWindow(
  existing: WindowCounterDoc | undefined,
  kind: string,
  now: Date,
  windowMs: number,
  max: number,
): WindowCounterWrite | null {
  const withinWindow =
    Boolean(existing) && now.getTime() - toMillis(existing!.windowStart) < windowMs;
  if (withinWindow && existing!.count >= max) return null;

  const windowStart = withinWindow ? existing!.windowStart : now;
  return {
    kind,
    count: withinWindow ? existing!.count + 1 : 1,
    windowStart,
    updatedAt: now,
    // One full window past the last request, not past the window start: a
    // document being actively written must not be swept out from under a
    // live counter, which would hand an attacker a free reset.
    expiresAt: new Date(now.getTime() + windowMs),
  };
}

/**
 * The caller's IP, as a document id.
 *
 * WHY THE SECOND-TO-LAST ENTRY. Requests to a gen-2 function arrive through
 * Google's front end, which *appends* to whatever `X-Forwarded-For` the client
 * sent: a client that sends nothing produces `<client-ip>, <gfe-ip>`, and a
 * client that sends a forged `1.2.3.4` produces `1.2.3.4, <client-ip>,
 * <gfe-ip>`. In both cases the entry Google added — the one the client cannot
 * choose — is second from the end. Taking `parts[0]`, the conventional
 * reading, is exactly the version an attacker defeats by sending one header.
 *
 * WHAT THIS IS AND IS NOT. It is a cost guard, not an authentication boundary.
 * Anyone with a botnet or a proxy pool has as many keys as they want, and no
 * per-IP limit changes that; `maxInstances` on the function is what bounds
 * that case. What this stops is the cheap attack the audit actually found —
 * one script, one host, cycling email addresses to walk straight past a limit
 * that is keyed on the address.
 *
 * The IP is hashed rather than stored. An IP address is personal data in
 * several jurisdictions, the counter needs equality only, and a hash gives
 * that with no raw addresses sitting in Firestore.
 *
 * Returns `undefined` when no address can be determined, which makes the
 * caller fail *open* on the IP dimension. That is deliberate: the per-email
 * limit still applies, and bricking sign-in for everyone because a header was
 * missing is a worse outcome than missing one limit.
 */
export function callerIp(rawRequest: {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): string | undefined {
  const header = rawRequest.headers?.['x-forwarded-for'];
  const chain = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (chain.length >= 2) return chain[chain.length - 2];
  if (chain.length === 1) return chain[0];
  return rawRequest.ip || rawRequest.socket?.remoteAddress || undefined;
}

/**
 * `rateLimits/{id}` for a per-IP counter. Prefixed so it can never collide
 * with the per-email counters, which are a bare 24-character hash.
 */
export function ipCounterId(functionName: string, ip: string): string {
  return `ip_${functionName}_${createHash('sha256').update(ip).digest('hex').slice(0, 24)}`;
}

/**
 * The caller's IP when the endpoint is a Next.js route handler or server
 * action on the droplet.
 *
 * `callerIp` above cannot be reused as-is: the two hosts put the entry a
 * client cannot choose in different places, and reading the wrong one hands an
 * attacker a free reset of every per-IP counter by sending one header.
 *
 *   Cloud Functions gen-2: Google's front end appends, then adds its own hop,
 *   so the trusted entry is second from the end. That is what `callerIp` takes.
 *
 *   The droplet: Apache's `mod_proxy` APPENDS the connecting address to
 *   whatever `X-Forwarded-For` the client sent, and nothing sits in front of
 *   Apache. So the LAST entry is the one the client cannot forge; everything
 *   before it is client-supplied text. `apps/web/src/lib/checkout-limit.ts`
 *   reads the same entry.
 *
 * This used to prefer `x-nf-client-connection-ip` and then the FIRST entry,
 * which was right on Netlify. Netlify is gone, Apache passes both headers
 * through untouched, and so any script could pick a new "IP" per request
 * (T258 #12, T263).
 *
 * `next dev` has no proxy and no header, so this returns `undefined` there,
 * and callers fail open on the IP dimension only: the per-address caps still
 * apply, and bricking sign-in for a whole venue over a missing header is the
 * worse outcome.
 */
export function callerIpFromHeaders(headers: {
  get(name: string): string | null;
}): string | undefined {
  const chain = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return chain[chain.length - 1] || undefined;
}

// ── The shared abuse limiter ────────────────────────────────────────────────
//
// One limiter for every endpoint that mails a code or an email to an address
// the caller chooses: dashboard sign-in and confirm codes, the www ticket pass,
// the blog editor, the CFP form and the invoice form (T264). Before it, each of
// those had only a resend floor on the code document, and that document was
// deleted when its tries ran out, so a script could ask for a fresh code at
// once and guess without end (T263 P1).
//
// Two pieces:
//
//   `takeAllowance` counts requests per address and per caller IP against an
//   hourly AND a daily cap, in `rateLimits` documents that nothing deletes
//   (the TTL policy sweeps them a window after their last write).
//
//   `recordFailedGuess` / `guessesLocked` count wrong codes per address
//   ACROSS codes, so asking for a new code does not reset them. Ten wrong in
//   an hour locks the address for 15 minutes; thirty in a day locks it until
//   that day's window ends.
//
// Every write is a native `Date` (see `WindowCounterWrite`), and the store is
// passed in, so the same code runs under each app's own `firebase-admin`.

/** One cap: at most `max` per fixed window of `windowMs`. */
export interface Cap {
  max: number;
  windowMs: number;
}

export const HOUR_MS = 60 * 60_000;
export const DAY_MS = 24 * HOUR_MS;

/** A cap per hour and a cap per day, the shape every caller here wants. */
export const perHourAndDay = (hour: number, day: number): Cap[] => [
  { max: hour, windowMs: HOUR_MS },
  { max: day, windowMs: DAY_MS },
];

type Millis = Date | { toMillis(): number };

export interface CapsCounterDoc {
  kind: string;
  /** Keyed by `String(windowMs)`, so one document holds the hour and the day. */
  windows: Record<string, { count: number; start: Millis }>;
  /** Set by `recordFailedGuess` only. */
  lockedUntil?: Millis;
  updatedAt: Millis;
  /** Read only by the Firestore TTL policy, never by this code. */
  expiresAt: Millis;
}

/**
 * `rateLimits/{id}` for one dimension of one limiter. The value is hashed, as
 * `ipCounterId` does, so no raw address or IP sits in Firestore, and it is
 * prefixed `lim_` so it can never collide with the older counter shapes.
 */
export function limitId(scope: string, dimension: 'ip' | 'email' | 'fail', value: string): string {
  const key = createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 24);
  return `lim_${scope}_${dimension}_${key}`;
}

/**
 * What a caps document becomes after one more request, or `null` when any cap
 * is already full or the document is locked. Pure, like `tickWindow`, so the
 * window edges are testable without an emulator.
 */
export function tickCaps(
  existing: CapsCounterDoc | undefined,
  kind: string,
  now: Date,
  caps: Cap[],
): CapsCounterDoc | null {
  if (existing?.lockedUntil && toMillis(existing.lockedUntil) > now.getTime()) return null;
  const windows: CapsCounterDoc['windows'] = {};
  for (const cap of caps) {
    const key = String(cap.windowMs);
    const prior = existing?.windows?.[key];
    const within = Boolean(prior) && now.getTime() - toMillis(prior!.start) < cap.windowMs;
    if (within && prior!.count >= cap.max) return null;
    windows[key] = within ? { count: prior!.count + 1, start: prior!.start } : { count: 1, start: now };
  }
  const longest = Math.max(...caps.map((c) => c.windowMs));
  return {
    kind,
    windows,
    ...(existing?.lockedUntil ? { lockedUntil: existing.lockedUntil } : {}),
    updatedAt: now,
    expiresAt: new Date(now.getTime() + longest),
  };
}

/** One dimension to count a request against. An `undefined` id is skipped. */
export interface AllowanceCheck {
  id: string | undefined;
  kind: string;
  caps: Cap[];
}

/**
 * Count one request against every check, all or nothing: if any cap is full,
 * nothing is written and the answer is false.
 *
 * Fails CLOSED on an error (unlike the checkout limiter). Everything behind it
 * either mails somebody or hands out a sign-in, and the store that would have
 * recorded the code is the same one that just failed, so refusing costs a
 * genuine caller one "try again in a minute".
 */
export async function takeAllowance(
  db: Firestore,
  checks: AllowanceCheck[],
  now = new Date(),
): Promise<boolean> {
  const live = checks.filter((c): c is AllowanceCheck & { id: string } => Boolean(c.id));
  if (live.length === 0) return true;
  try {
    return await db.runTransaction(async (tx) => {
      const refs = live.map((c) => db.collection(COLLECTIONS.rateLimits).doc(c.id));
      const snaps = await Promise.all(refs.map((r) => tx.get(r)));
      const next = live.map((c, i) => tickCaps(snaps[i].data() as CapsCounterDoc | undefined, c.kind, now, c.caps));
      if (next.some((n) => n === null)) return false;
      next.forEach((n, i) => tx.set(refs[i], n!));
      return true;
    });
  } catch (err) {
    console.error('[rate-limit] limiter failed, refusing the request', err);
    return false;
  }
}

/** Wrong codes per address, across codes. */
export const FAILED_GUESS_HOURLY = 10;
export const FAILED_GUESS_DAILY = 30;
export const FAILED_GUESS_LOCK_MS = 15 * 60_000;

/**
 * The failure document after one more wrong code. Pure.
 *
 * The tenth wrong code in an hour sets a 15-minute lock and starts a fresh
 * hour, so the next ten are counted after it. The thirtieth in a day locks
 * until the day window ends, which caps a patient attacker at thirty guesses
 * a day against a million codes.
 */
export function tickFailure(existing: CapsCounterDoc | undefined, now: Date): CapsCounterDoc {
  const hour = String(HOUR_MS);
  const day = String(DAY_MS);
  const count = (key: string, windowMs: number) => {
    const prior = existing?.windows?.[key];
    const within = Boolean(prior) && now.getTime() - toMillis(prior!.start) < windowMs;
    return within ? { count: prior!.count + 1, start: prior!.start } : { count: 1, start: now as Millis };
  };
  const h = count(hour, HOUR_MS);
  const d = count(day, DAY_MS);
  let lockedUntil: Millis | undefined =
    existing?.lockedUntil && toMillis(existing.lockedUntil) > now.getTime() ? existing.lockedUntil : undefined;
  let hourWindow = h;
  if (d.count >= FAILED_GUESS_DAILY) {
    lockedUntil = new Date(toMillis(d.start) + DAY_MS);
  } else if (h.count >= FAILED_GUESS_HOURLY) {
    lockedUntil = new Date(now.getTime() + FAILED_GUESS_LOCK_MS);
    hourWindow = { count: 0, start: now };
  }
  return {
    kind: 'failed-guess',
    windows: { [hour]: hourWindow, [day]: d },
    ...(lockedUntil ? { lockedUntil } : {}),
    updatedAt: now,
    expiresAt: new Date(Math.max(now.getTime() + DAY_MS, lockedUntil ? toMillis(lockedUntil) : 0)),
  };
}

/** Count one wrong code for this address on this surface. Never throws. */
export async function recordFailedGuess(db: Firestore, scope: string, email: string, now = new Date()): Promise<void> {
  const ref = db.collection(COLLECTIONS.rateLimits).doc(limitId(scope, 'fail', email));
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      tx.set(ref, tickFailure(snap.data() as CapsCounterDoc | undefined, now));
    });
  } catch (err) {
    console.error('[rate-limit] could not record a failed code', err);
  }
}

/** Is this address locked out of entering codes on this surface? Fails closed. */
export async function guessesLocked(db: Firestore, scope: string, email: string, now = new Date()): Promise<boolean> {
  try {
    const d = (await db.collection(COLLECTIONS.rateLimits).doc(limitId(scope, 'fail', email)).get()).data() as
      | CapsCounterDoc
      | undefined;
    return Boolean(d?.lockedUntil && toMillis(d.lockedUntil) > now.getTime());
  } catch (err) {
    console.error('[rate-limit] could not read the lock, refusing', err);
    return true;
  }
}

/**
 * The limits for a six-digit code surface (dashboard, ticket pass, blog).
 *
 * Per address: a few codes an hour and a few more a day, so with five tries a
 * code an owner address can take at most 100 guesses a day before the failure
 * lock, and 30 after it. Per IP: loose enough for a venue behind one NAT
 * address, tight enough that one script cannot mail thousands of addresses.
 */
export interface CodeLimits {
  requestPerEmail: Cap[];
  requestPerIp: Cap[];
  verifyPerIp: Cap[];
}

export const DEFAULT_CODE_LIMITS: CodeLimits = {
  requestPerEmail: perHourAndDay(5, 20),
  requestPerIp: perHourAndDay(60, 300),
  verifyPerIp: perHourAndDay(120, 600),
};

/** Count one "send me a code". False means do not send. */
export function codeRequestAllowed(
  db: Firestore,
  scope: string,
  email: string,
  ip: string | undefined,
  limits: CodeLimits = DEFAULT_CODE_LIMITS,
  now = new Date(),
): Promise<boolean> {
  return takeAllowance(
    db,
    [
      { id: limitId(scope, 'email', email), kind: `${scope}-email`, caps: limits.requestPerEmail },
      { id: ip ? limitId(scope, 'ip', ip) : undefined, kind: `${scope}-ip`, caps: limits.requestPerIp },
    ],
    now,
  );
}

/**
 * Before checking a code: `locked` when the address has too many wrong codes,
 * `limited` when this IP has tried too many, else `ok`.
 */
export async function codeVerifyGate(
  db: Firestore,
  scope: string,
  email: string,
  ip: string | undefined,
  limits: CodeLimits = DEFAULT_CODE_LIMITS,
  now = new Date(),
): Promise<'ok' | 'locked' | 'limited'> {
  if (await guessesLocked(db, scope, email, now)) return 'locked';
  const ok = await takeAllowance(
    db,
    [{ id: ip ? limitId(`${scope}-verify`, 'ip', ip) : undefined, kind: `${scope}-verify-ip`, caps: limits.verifyPerIp }],
    now,
  );
  return ok ? 'ok' : 'limited';
}
