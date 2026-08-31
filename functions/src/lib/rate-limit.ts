import { createHash } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';

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
  now: Timestamp,
  windowMs: number,
  max: number,
): WindowCounterDoc | null {
  const withinWindow = Boolean(existing) && now.toMillis() - existing!.windowStart.toMillis() < windowMs;
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
    expiresAt: Timestamp.fromMillis(now.toMillis() + windowMs),
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
