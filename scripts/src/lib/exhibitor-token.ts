import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The capability token that opens one exhibitor's lead desk.
 *
 * The seventh use of the scheme `order-token.ts` introduced and
 * `unsubscribe-token.ts`, `consent-token.ts`, `submission-token.ts`,
 * `reviewer-token.ts` and `speaker-token.ts` copied — HMAC-SHA256 over a
 * base64url JSON body, the same `body.signature` shape, the same constant-time
 * compare — and it lives in this package for the reason all six do: the
 * dashboard mints the link and `apps/web` honours it, and neither of those apps
 * can import the other.
 * ⚠️ Do not add an eighth *scheme*; this is a seventh *use* of one scheme,
 * which is the opposite thing.
 *
 * ── Why a token rather than a login ─────────────────────────────────────────
 *
 * The same argument `speaker-token.ts` makes, and it is a wider case. Booth
 * staff are not attendees: they are whoever the exhibiting company put on the
 * stand that morning, often two people who were told about it the night before.
 * There is no `registrations` row, no Firebase account and nothing for
 * `firestore.rules` to check, and an exhibitor portal with accounts would mean
 * provisioning credentials for people whose names nobody knows in advance.
 *
 * A URL keyed by the exhibitor id would not do either: exhibitor ids are
 * slugs of the company name, so anybody could type one.
 *
 * ── What holding this token lets you do ─────────────────────────────────────
 *
 * Scan a badge that is held up to the camera, and read back **only the leads
 * taken with this link**. It cannot list attendees, cannot look anybody up by
 * name or address, and cannot see another exhibitor's leads. The one way a
 * person enters this exhibitor's list is by standing at the booth with their
 * badge and agreeing on screen — so the worst a stolen link does is show
 * whoever holds it the contacts that company had already been given, and let
 * them take more only from people physically at the stand.
 *
 * It is not a proof of identity and this file does not pretend it is. What is
 * proved is "somebody who received the mail we sent to the address on this
 * exhibitor's record opened it" — the same standard the other six document.
 *
 * ── The payload, and what is deliberately absent ────────────────────────────
 *
 * `{ t, xid, iat }` and nothing more. No company name, no address, no booth
 * number. A URL that carries an email discloses it to every server log,
 * `Referer` header and forwarded message it passes through, and a booth link is
 * forwarded to a stand manager more often than most.
 *
 * `t` is the token-type discriminator every file in this family carries. All
 * seven fall back to `WEB_ORDER_SECRET`, so on a deployment that sets only that
 * one variable the signature alone cannot say which family a body belongs to;
 * `t` is checked strictly on read, so a speaker token can never be replayed as
 * an exhibitor token even under a shared key.
 *
 * ── Expiry and revocation ───────────────────────────────────────────────────
 *
 * **Expiry: 120 days.** Shorter than the speaker portal's 180, because this one
 * has a much narrower useful life: a lead desk is wanted from the week the
 * stand is confirmed until the week after the hall closes. It is long enough to
 * send with the exhibitor pack in the spring and still open on the last
 * afternoon; longer than that is a live URL sitting in a shared booth inbox
 * with nothing left to do.
 *
 * **Revocation: in the caller, not here.** `ExhibitorDoc.leadLinksValidFrom` is
 * epoch milliseconds and `iat` is in the payload, so refusing every link minted
 * before an instant is one comparison the store makes on every request. That
 * keeps this file stateless and makes "kill the old link" a single field write
 * rather than a key rotation that would break every other exhibitor's link at
 * the same time. ⚠️ The caller does that check. This file does not.
 *
 * **The accepted threat, plainly: this token is a bearer credential for one
 * exhibitor's own lead list, for up to four months.** Whoever holds the URL can
 * read the contacts that exhibitor has already been given and can add to them
 * only by scanning a badge in front of the camera, with the attendee agreeing
 * on screen. **Not** accepted, and closed by the containment: reading any
 * attendee who has not been scanned by this exhibitor, reading another
 * exhibitor's leads, and looking anybody up by name or address.
 */

/**
 * How long a lead-desk link stays usable. Exported because the mail that
 * carries the link should be able to say so, and a second copy of "120 days" in
 * a template is a sentence that will one day be wrong.
 */
export const EXHIBITOR_TOKEN_TTL_MS = 120 * 24 * 60 * 60 * 1000;

export interface ExhibitorTokenPayload {
  /** Token family. Always `'exh'`; see the note on shared secrets above. */
  t: 'exh';
  /** The `exhibitors/{id}` document id. */
  xid: string;
  /** Issued-at, epoch ms. Also what revocation is compared against. */
  iat: number;
}

function secret(): string {
  /*
   * Its own variable with a fallback, exactly as the other six have, and for
   * the reason `consent-token.ts` gives: `WEB_ORDER_SECRET` is documented as
   * rotatable, and a rotation that also silently killed every outstanding booth
   * link would be discovered on the morning of the exhibition, by somebody
   * standing at a stand with a queue in front of them.
   */
  const s = process.env.WEB_EXHIBITOR_SECRET ?? process.env.WEB_ORDER_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      'Neither WEB_EXHIBITOR_SECRET nor WEB_ORDER_SECRET is set (or one is too short). ' +
        'One of them signs exhibitor lead links; without it an exhibitor cannot be sent a way ' +
        'to scan badges at their booth. Generate one with: openssl rand -base64 32',
    );
  }
  return s;
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

/**
 * Mints a link for one exhibitor.
 *
 * ⚠️ `iat` is a native `Date` reduced to epoch ms, never a Firestore sentinel.
 * `@kgc/scripts` resolves its own copy of `firebase-admin`, and a
 * `Timestamp`/`FieldValue` built here and handed to a store created in
 * `apps/web` fails the entire write on an `instanceof` check — AGENTS.md
 * gotcha 8.
 */
export function mintExhibitorToken(exhibitorId: string): string {
  const payload: ExhibitorTokenPayload = { t: 'exh', xid: exhibitorId, iat: Date.now() };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Returns null for anything tampered with, malformed, of the wrong family or expired. */
export function readExhibitorToken(token: string): ExhibitorTokenPayload | null {
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
    ) as ExhibitorTokenPayload;
    if (parsed.t !== 'exh') return null;
    if (typeof parsed.xid !== 'string' || !parsed.xid) return null;
    if (typeof parsed.iat !== 'number' || !Number.isFinite(parsed.iat)) return null;
    if (Date.now() - parsed.iat > EXHIBITOR_TOKEN_TTL_MS) return null;
    return { t: 'exh', xid: parsed.xid, iat: parsed.iat };
  } catch {
    return null;
  }
}

/**
 * Whether a link minted at `iat` still opens.
 *
 * The revocation half, kept beside the token rather than in the website's store
 * because the dashboard has to answer the same question when it decides whether
 * to show "revoked" beside a row. `speaker-portal-core.ts` holds the identical
 * function for speakers, and the two are separate only because they read
 * different documents.
 *
 * `leadLinksValidFrom` absent means nothing has ever been revoked, which is the
 * common case and must not be read as "everything is revoked".
 */
export function exhibitorLinkOpens(input: {
  iat: number;
  leadLinksValidFrom?: number;
  exhibitorEventId?: string;
  eventId: string;
  status?: string;
}): boolean {
  if (input.exhibitorEventId && input.exhibitorEventId !== input.eventId) return false;
  /*
   * A cancelled exhibitor's link stops working. They are not on the floor, so
   * there is nobody to scan — and leaving it open would mean a company that
   * pulled out keeps a live reader on the contacts it took last year.
   */
  if (input.status === 'cancelled') return false;
  if (typeof input.leadLinksValidFrom === 'number' && input.iat < input.leadLinksValidFrom) {
    return false;
  }
  return true;
}
