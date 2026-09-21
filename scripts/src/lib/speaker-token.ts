import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The capability token that opens one speaker's own profile page.
 *
 * The sixth use of the scheme `order-token.ts` introduced and
 * `unsubscribe-token.ts`, `consent-token.ts`, `submission-token.ts` and
 * `reviewer-token.ts` copied — HMAC-SHA256 over a base64url JSON body, the same
 * `body.signature` shape, the same constant-time compare — and it lives in this
 * package for the reason all five do: the dashboard mints the link and
 * `apps/web` honours it, and neither of those apps can import the other.
 * ⚠️ Do not add a seventh *scheme*; this is a sixth *use* of one scheme, which
 * is the opposite thing.
 *
 * ── Why a token rather than a login ─────────────────────────────────────────
 *
 * The same argument `consent-token.ts` makes, and it is the same people:
 * `SpeakerDoc` is authored by the programme committee from a CSV, most speakers
 * never buy a ticket, so most of them have no `registrations` row, no Firebase
 * account and nothing `firestore.rules` could check. A speaker portal that
 * required a ticket would be a portal most speakers cannot open.
 *
 * A URL keyed by the speaker id would not do either: speaker ids are derived
 * (`slug(name)` plus a hash of name and company — see `ids.ts`), so anybody
 * holding the public speakers page could compute one and rewrite somebody
 * else's bio.
 *
 * ── What holding this token lets you do ─────────────────────────────────────
 *
 * Read **one** speaker's own profile and the titles of the sessions they are
 * on, and propose a change to it. Nothing else, and in particular nothing takes
 * effect: everything sent through this link is held as a draft until an
 * organizer approves it. So the worst a stolen link does is waste an
 * organizer's time, not deface the agenda.
 *
 * It is not a proof of identity and this file does not pretend it is. What is
 * proved is "somebody who received the mail we sent to the address on this
 * speaker's record opened it" — the same standard `consent-token.ts` documents.
 *
 * ── The payload, and what is deliberately absent ────────────────────────────
 *
 * `{ t, sid, iat }` and nothing more. No name, no address, no session ids. A
 * URL that carries an email discloses it to every server log, `Referer` header
 * and forwarded message it passes through, and a profile link is forwarded to
 * an assistant more often than most.
 *
 * `t` is the token-type discriminator every file in this family carries. All
 * six fall back to `WEB_ORDER_SECRET`, so on a deployment that sets only that
 * one variable the signature alone cannot say which family a body belongs to;
 * `t` is checked strictly on read, so a consent token can never be replayed as
 * a speaker token even under a shared key. `sid` collides by name with
 * `submission-token.ts`, which is exactly why `t` is not optional.
 *
 * ── Expiry and revocation ───────────────────────────────────────────────────
 *
 * **Expiry: 180 days.** A bio chase starts when the programme is announced and
 * ends when the conference does, so the link has to outlive months of "I will
 * do it this weekend". Longer than that is a live URL sitting in an inbox for
 * no remaining purpose.
 *
 * **Revocation: in the caller, not here.** `SpeakerProfileEditDoc.linksValidFrom`
 * is epoch milliseconds and `iat` is in the payload, so refusing every link
 * minted before an instant is one comparison the store makes on every request.
 * That keeps this file stateless — a nonce list would reintroduce exactly the
 * state this scheme exists to avoid — and it makes "kill the old link" a single
 * field write rather than a key rotation that would break every other speaker's
 * link at the same time. ⚠️ The caller does that check. This file does not.
 *
 * **The accepted threat, plainly: this token is a bearer credential for one
 * speaker's own profile, for up to six months.** Whoever holds the URL can read
 * that speaker's bio, title, company, links and session titles — all of which
 * are published on the public website anyway — and can propose a change that an
 * organizer will see, attributed to that speaker, before anything is published.
 * **Not** accepted, and closed by keeping the payload opaque: disclosure of the
 * speaker's contact address, and any write that reaches a public page without a
 * person approving it.
 */

/**
 * How long a profile link stays usable. Exported because the mail that carries
 * the link should be able to say so, and a second copy of "180 days" in a
 * template is a sentence that will one day be wrong.
 */
export const SPEAKER_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export interface SpeakerTokenPayload {
  /** Token family. Always `'spk'`; see the note on shared secrets above. */
  t: 'spk';
  /** The `speakers/{id}` document id. */
  sid: string;
  /** Issued-at, epoch ms. Also what revocation is compared against. */
  iat: number;
}

function secret(): string {
  /*
   * Its own variable with a fallback, exactly as the other five have, and for
   * the reason `consent-token.ts` gives: `WEB_ORDER_SECRET` is documented as
   * rotatable, and a rotation that also silently killed every outstanding
   * profile link would be discovered as "the speakers stopped sending bios",
   * weeks later, with nothing in any log to say why.
   */
  const s = process.env.WEB_SPEAKER_SECRET ?? process.env.WEB_ORDER_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      'Neither WEB_SPEAKER_SECRET nor WEB_ORDER_SECRET is set (or one is too short). ' +
        'One of them signs speaker profile links; without it a speaker cannot be sent a way ' +
        'to fill in their own profile. Generate one with: openssl rand -base64 32',
    );
  }
  return s;
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

/**
 * Mints a link for one speaker.
 *
 * ⚠️ `iat` is a native `Date` reduced to epoch ms, never a Firestore sentinel.
 * `@kgc/scripts` resolves its own copy of `firebase-admin`, and a
 * `Timestamp`/`FieldValue` built here and handed to a store created in
 * `apps/web` fails the entire write on an `instanceof` check — AGENTS.md
 * gotcha 8.
 */
export function mintSpeakerToken(speakerId: string): string {
  const payload: SpeakerTokenPayload = { t: 'spk', sid: speakerId, iat: Date.now() };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Returns null for anything tampered with, malformed, of the wrong family or expired. */
export function readSpeakerToken(token: string): SpeakerTokenPayload | null {
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
    ) as SpeakerTokenPayload;
    if (parsed.t !== 'spk') return null;
    if (typeof parsed.sid !== 'string' || !parsed.sid) return null;
    if (typeof parsed.iat !== 'number' || !Number.isFinite(parsed.iat)) return null;
    if (Date.now() - parsed.iat > SPEAKER_TOKEN_TTL_MS) return null;
    return { t: 'spk', sid: parsed.sid, iat: parsed.iat };
  } catch {
    return null;
  }
}
