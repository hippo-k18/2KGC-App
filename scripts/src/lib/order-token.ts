import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The capability token that unlocks a confirmation page.
 *
 * The confirmation page shows a claim code, which is a sign-in credential for
 * the mobile app. It therefore cannot live at a guessable URL — and
 * `/order/{registrationId}` *is* guessable, because `registrationId` is
 * `sha256(email)` by design (that derivation is what makes a repeat purchase
 * update rather than duplicate). Anyone who knew an attendee's address could
 * compute the path and read their claim code.
 *
 * So the URL carries a short-lived HMAC-signed token instead. Nothing is
 * stored: the token *is* the authorisation, it expires on its own, and the
 * registration keeps exactly the fields `RegistrationDoc` declares — no extra
 * "confirmation token" column that then has to be cleaned up.
 */

/**
 * How long a confirmation link stays valid.
 *
 * This was a week, which was right when the only way to receive one was the
 * post-checkout redirect. It is wrong now that the link is *emailed*: tickets
 * for a May conference go on sale the previous August, and a link that dies in
 * seven days turns every "where is my badge?" into a support ticket.
 *
 * Lengthening it costs less than it appears to. The token exists to stop
 * someone who knows an attendee's email address from computing their
 * `registrationId` — it is `reg_` + sha256(email) — and reading their claim
 * code. It does **not** defend against someone holding the confirmation email,
 * because that email contains the claim code in its body. So a longer-lived
 * token in that same email widens no exposure that the email itself does not
 * already carry; it only keeps working for as long as the mail does.
 *
 * Six months rather than forever, so a token that leaks out of an inbox years
 * later is not still live.
 */
const TTL_MS = 180 * 24 * 60 * 60 * 1000;

export interface OrderTokenPayload {
  /** The `registrations/{id}` document id. */
  rid: string;
  /** Issued-at, epoch ms. */
  iat: number;
  /** True when no payment was taken — the site is running without Stripe. */
  demo: boolean;
}

function secret(): string {
  const s = process.env.WEB_ORDER_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      'WEB_ORDER_SECRET is missing or too short. It signs order confirmation links; ' +
        'without it anyone who knows an attendee’s email address could read their claim code. ' +
        'Generate one with: openssl rand -base64 32',
    );
  }
  return s;
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

export function mintOrderToken(payload: Omit<OrderTokenPayload, 'iat'>): string {
  const body = b64url(JSON.stringify({ ...payload, iat: Date.now() }));
  return `${body}.${sign(body)}`;
}

/** Returns null for anything tampered with, malformed or expired. */
export function readOrderToken(token: string): OrderTokenPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const want = Buffer.from(sign(body), 'base64url');

  // Constant-time, and length-checked first because `timingSafeEqual` throws
  // on a length mismatch rather than returning false.
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OrderTokenPayload;
    if (typeof parsed.rid !== 'string' || typeof parsed.iat !== 'number') return null;
    if (Date.now() - parsed.iat > TTL_MS) return null;
    return { rid: parsed.rid, iat: parsed.iat, demo: parsed.demo === true };
  } catch {
    return null;
  }
}
