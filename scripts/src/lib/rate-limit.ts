import { createHash } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';

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
 * The caller's IP when the endpoint is a **Next.js route handler** rather than
 * a Cloud Function.
 *
 * `callerIp` above cannot be reused as-is, and the reason is the whole point of
 * having two functions instead of one: the two hosts put the untrusted and the
 * trusted entry in *different places*, and reading the wrong one hands an
 * attacker a free reset of the per-IP counter by sending one header.
 *
 *   Cloud Functions gen-2 — Google's front end APPENDS to whatever
 *   `X-Forwarded-For` the client sent, so the entry the client cannot choose is
 *   second from the end. That is what `callerIp` takes.
 *
 *   Netlify — `x-forwarded-for` arrives with the client's own value FIRST and
 *   is therefore forgeable end to end. What is not forgeable is
 *   `x-nf-client-connection-ip`, which Netlify's edge sets from the TCP peer
 *   and strips from anything inbound. So that header is preferred outright, and
 *   `x-forwarded-for` is consulted only when it is absent — which is the
 *   `next dev` case, where the only caller is the developer's own machine.
 *
 * Same posture as `callerIp` on failure: returns `undefined` and lets the
 * caller fail *open* on the IP dimension, because the per-email limit still
 * applies and bricking sign-in for a whole venue over a missing header is the
 * worse outcome.
 */
export function callerIpFromHeaders(headers: {
  get(name: string): string | null;
}): string | undefined {
  const netlify = headers.get('x-nf-client-connection-ip')?.trim();
  if (netlify) return netlify;

  const chain = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return chain[0] || undefined;
}
