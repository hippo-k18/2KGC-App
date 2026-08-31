import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The capability token behind the public unsubscribe link.
 *
 * A deliberate copy of `order-token.ts`'s scheme — same HMAC-SHA256 over a
 * base64url JSON body, same `body.signature` shape, same constant-time compare
 * — and it lives in this package for the same reason that one does: the mail
 * that carries the link is composed in `@kgc/scripts/src/lib/email.ts`, which
 * the organizer dashboard calls, while the page that honours it is in
 * `apps/web`. Neither of those two apps can import the other.
 *
 * ── Why a token at all ──────────────────────────────────────────────────────
 *
 * `contacts/{id}` is `contact_` + sha256 of the lower-cased address, exactly as
 * `registrations` is. So `/u/{contactId}` would be computable by anyone holding
 * an address, and the whole marketing list is guessable from a list of guessed
 * addresses — an unsubscribe endpoint that is also a membership oracle, and a
 * way to unsubscribe other people. The HMAC closes both: the id is in the URL
 * but only we can produce a URL that verifies.
 *
 * ── Three deliberate differences from the order token ───────────────────────
 *
 * **No expiry.** The order token is six months because the link it protects
 * shows a claim code. This one authorises exactly one thing — stopping mail —
 * and an expired unsubscribe link is a legal problem rather than a security
 * improvement: somebody who finds a 2027 newsletter in 2029 and clicks
 * "unsubscribe" must be unsubscribed, not shown an error. `iat` is carried for
 * diagnostics and is never checked.
 *
 * **Its own secret, and a fallback.** `WEB_ORDER_SECRET` is documented as
 * rotatable ("rotating it invalidates outstanding confirmation links"), which
 * is an acceptable cost for a confirmation page and not for an unsubscribe
 * link. So this reads `WEB_UNSUBSCRIBE_SECRET` first. It falls back to
 * `WEB_ORDER_SECRET` rather than throwing, because the alternative is a bulk
 * send that goes out with no unsubscribe link at all on a deployment where
 * somebody forgot one environment variable — which is the failure this file
 * exists to prevent.
 *
 * **The payload carries an id and never an address.** URLs end up in server
 * logs, in `Referer` headers and in browser history. The id is a hash, so a
 * leaked URL discloses nothing on its own.
 */

export interface UnsubscribeTokenPayload {
  /** The `contacts/{id}` document id. */
  cid: string;
  /** Issued-at, epoch ms. Diagnostic only — never used to expire a link. */
  iat: number;
}

function secret(): string {
  const s = process.env.WEB_UNSUBSCRIBE_SECRET ?? process.env.WEB_ORDER_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      'Neither WEB_UNSUBSCRIBE_SECRET nor WEB_ORDER_SECRET is set (or one is too short). ' +
        'One of them signs the public unsubscribe link; without it a bulk campaign cannot ' +
        'legally be sent. Generate one with: openssl rand -base64 32',
    );
  }
  return s;
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

export function mintUnsubscribeToken(contactId: string): string {
  const body = b64url(JSON.stringify({ cid: contactId, iat: Date.now() }));
  return `${body}.${sign(body)}`;
}

/** Returns null for anything tampered with or malformed. Never expires. */
export function readUnsubscribeToken(token: string): UnsubscribeTokenPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const want = Buffer.from(sign(body), 'base64url');

  // Length-checked first: `timingSafeEqual` throws on a length mismatch rather
  // than returning false.
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as UnsubscribeTokenPayload;
    if (typeof parsed.cid !== 'string' || !parsed.cid) return null;
    return { cid: parsed.cid, iat: typeof parsed.iat === 'number' ? parsed.iat : 0 };
  } catch {
    return null;
  }
}
