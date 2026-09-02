import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The capability token behind a consent signing link.
 *
 * The third use of the scheme `order-token.ts` introduced and
 * `unsubscribe-token.ts` copied — HMAC-SHA256 over a base64url JSON body, the
 * same `body.signature` shape, the same constant-time compare — and it lives in
 * this package for the same reason those two do: the dashboard mints the link
 * and `apps/web` honours it, and neither of those apps can import the other.
 * ⚠️ Do not add a fourth scheme. A second encoding of the same idea is a second
 * chance for the two ends to disagree, and the symptom is a link that silently
 * fails to verify for the one speaker who tries it at 23:00.
 *
 * ── Why a token rather than a login ─────────────────────────────────────────
 *
 * A speaker has no account here. `SpeakerDoc` is authored by the programme
 * committee from a CSV; most speakers never buy a ticket, so most of them have
 * no `registrations` row, no Firebase account and no way to be authenticated at
 * all. The alternatives were an account nobody wants for one signature, or a
 * URL keyed by the speaker id — and speaker ids are derived (`slug(name)` plus
 * a hash of name and company, see `ids.ts`), so anybody holding the public
 * speaker list could compute one and sign in somebody else's name.
 *
 * ── What holding this token lets you do ─────────────────────────────────────
 *
 * Read one consent form's wording, and record a signature against **one named
 * subject**. It carries no read access to anything else: not the speaker's
 * address, not their other consents, not the register. That matters because a
 * consent link is emailed, and emailed URLs end up in server logs, `Referer`
 * headers and browser history.
 *
 * It is not a proof of identity and this file does not pretend it is. What is
 * actually proved is "somebody who received the mail we sent to this speaker's
 * address opened it and typed a name" — which is the same standard a paper
 * release posted to somebody's office meets, and the honest way to describe it
 * on the register is the `channel: 'link'` field rather than a claim of
 * authentication. `ConsentResponseDoc` says so in place.
 */

/** How long a signing link stays usable. */
const TTL_MS = 180 * 24 * 60 * 60 * 1000;

export interface ConsentTokenPayload {
  /** The `consentForms/{id}` document id. */
  fid: string;
  /**
   * Who the link was minted for, in the vocabulary `consentResponseId()` uses:
   * `spk_{speakerId}` for a speaker, a Firebase uid for somebody who has an
   * account but is being mailed a link anyway.
   *
   * An opaque reference and never an address, for the reason above: a URL that
   * carries an email address discloses it to every log the request passes
   * through, and a consent link is forwarded more often than most.
   */
  sub: string;
  /** Issued-at, epoch ms. */
  iat: number;
}

function secret(): string {
  /*
   * Its own variable, with a fallback, exactly as the unsubscribe token has.
   * `WEB_ORDER_SECRET` is documented as rotatable — rotating it invalidates
   * outstanding confirmation links — and a rotation that also silently killed
   * every outstanding signing link would be discovered as "the speakers stopped
   * signing", weeks later, with no error anywhere. Falling back rather than
   * throwing because the alternative is a deployment that forgot one variable
   * mailing signing links that 404, which is worse than sharing a secret.
   */
  const s = process.env.WEB_CONSENT_SECRET ?? process.env.WEB_ORDER_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      'Neither WEB_CONSENT_SECRET nor WEB_ORDER_SECRET is set (or one is too short). ' +
        'One of them signs consent signing links; without it a speaker cannot be sent a ' +
        'release to sign. Generate one with: openssl rand -base64 32',
    );
  }
  return s;
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

export function mintConsentToken(payload: Omit<ConsentTokenPayload, 'iat'>): string {
  const body = b64url(JSON.stringify({ ...payload, iat: Date.now() }));
  return `${body}.${sign(body)}`;
}

/** Returns null for anything tampered with, malformed or expired. */
export function readConsentToken(token: string): ConsentTokenPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const want = Buffer.from(sign(body), 'base64url');

  // Length-checked first: `timingSafeEqual` throws on a length mismatch rather
  // than returning false.
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ConsentTokenPayload;
    if (typeof parsed.fid !== 'string' || !parsed.fid) return null;
    if (typeof parsed.sub !== 'string' || !parsed.sub) return null;
    if (typeof parsed.iat !== 'number') return null;
    if (Date.now() - parsed.iat > TTL_MS) return null;
    return { fid: parsed.fid, sub: parsed.sub, iat: parsed.iat };
  } catch {
    return null;
  }
}

/**
 * `spk_{speakerId}` — a speaker as a consent signatory.
 *
 * A prefixed form rather than the bare speaker id, because the same field holds
 * Firebase uids and the register has to be able to tell the two apart without
 * consulting a second collection. `firestore.rules` only ever permits the uid
 * form from a client, so nothing a browser can write can claim to be a speaker.
 */
export const speakerSignatory = (speakerId: string) => `spk_${speakerId}`;

/**
 * The hash a form's version is pinned to — sha256 of the exact body text.
 *
 * Here rather than in either app because both compute it: the dashboard when it
 * publishes a version, and the website when it records a signature against one.
 * Two implementations would differ over trailing whitespace on the day somebody
 * pasted from Word, and the failure would be a signature the rules reject with
 * no explanation an organizer could act on.
 */
export const consentBodyHash = (body: string) =>
  createHash('sha256').update(body, 'utf8').digest('hex');
