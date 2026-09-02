import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The capability token that unlocks one abstract submission for its author.
 *
 * The fourth use of the scheme `order-token.ts` introduced and
 * `unsubscribe-token.ts` and `consent-token.ts` copied — HMAC-SHA256 over a
 * base64url JSON body, the same `body.signature` shape, the same constant-time
 * compare — and it lives in this package for the same reason those three do:
 * the submission portal in `apps/web` honours the link and the organizer
 * dashboard mints and re-sends it, and neither of those apps can import the
 * other. ⚠️ Do not add a fifth *scheme*; this is a fourth *use* of one scheme,
 * which is the opposite thing. A second verifier is how two halves of the
 * system come to disagree about who somebody is.
 *
 * ── Why a token rather than a login (CFA-PLAN §3) ───────────────────────────
 *
 * `isRegistered()` — the `registered` custom claim — is the gate for everything
 * in `firestore.rules`, and it is minted only for ticket holders. A prospective
 * speaker does not have it and **must not get it**: a submission portal that
 * requires a ticket is not a call for papers. Most people who submit an
 * abstract will never buy a ticket, and a meaningful number will never attend.
 *
 * The alternatives were an account nobody wants in order to type one abstract,
 * or a URL keyed by the submission id alone. The second is only safe while the
 * id is unguessable, and this repo has been bitten by exactly that assumption
 * before: `registrations` is keyed `reg_` + sha256(email), so anybody holding
 * an address can compute the path — which is *why* `/order/{token}` exists.
 * `submissions/{id}` is a minted, random id today (CFA-PLAN §2), but a token
 * that is safe only because of a property of some other file's id generator is
 * a trap left for whoever changes that file.
 *
 * ── What holding this token lets you do ─────────────────────────────────────
 *
 * Read and edit **one** submission while the call is open, and read that
 * submission's decision after it is made. Nothing else. Specifically it does
 * not carry: any other submission, any review, any reviewer's identity or
 * scores, the list of who else submitted, or the call's private configuration.
 *
 * It is not a proof of identity and this file does not pretend it is. What is
 * proved is "somebody who received the mail we sent to the address on this
 * submission opened it" — the same standard `consent-token.ts` documents for a
 * speaker release.
 *
 * ── What this token deliberately does NOT enforce ───────────────────────────
 *
 * **The deadline.** A token minted while the call was open still verifies after
 * the call closes, because it must: the author still has to be able to read
 * their submission and, later, their decision. Refusing the *write* after the
 * close date is the caller's job, in the server action, against the `calls`
 * document — never by hiding a button, and never by expiring this token.
 * CFA-PLAN §1 is blunt about it: "Deadline enforcement is server-side or it is
 * nothing." The next author to read this file will assume the token did it. It
 * did not.
 *
 * **Revocation of one link.** See below.
 *
 * ── The payload, and what is deliberately absent ────────────────────────────
 *
 * `{ t, sid, iat }` and nothing more. No author name, no affiliation, no email,
 * no `callId`.
 *
 * No address, because URLs end up in server logs, in `Referer` headers, in
 * browser history and in forwarded mail; a URL that carries an email discloses
 * it to every hop the request passes through. This is the badge-QR reasoning in
 * AGENTS.md applied to a link instead of a screen, and it rejects the same two
 * candidates for the same two reasons: an **email** is harvestable from wherever
 * the URL lands, and an **id derived from an email** is worse than it looks —
 * anyone holding the URL can test any address against it offline and get a yes
 * or no. An id that leaves the building is opaque or it is an oracle.
 *
 * No `callId`, for a different reason: the submission document already names its
 * call, so a copy in the token is a second answer to a question that already has
 * one, and the day the two disagree is a day somebody debugs a link rather than
 * a data bug. The caller loads the submission and reads `callId` from it.
 *
 * `t` is a token-type discriminator and it earns its place. Every token file in
 * this package falls back to `WEB_ORDER_SECRET`, so in a deployment that sets
 * only that one variable, all four families are signed by the same key and the
 * signature alone cannot say which family a body belongs to. Field names are
 * therefore effectively a shared namespace here: `sid` and `rvid` are chosen not
 * to collide with `rid` (order), `cid` (unsubscribe) or `fid`/`sub` (consent),
 * and `t` is checked strictly on read so that a reviewer token can never be
 * replayed as a submission token even under a shared secret.
 *
 * ── Expiry and revocation, and the threat accepted ──────────────────────────
 *
 * **Expiry: twelve months.** This link has to survive the entire life of a
 * call — opened in August for a May conference, closing in January, reviewed in
 * February, decided in March — plus the tail of "when do I hear back?". Six
 * months, which is what the order and consent tokens use, would kill the link
 * of the person who submitted on day one *before their own decision was made*,
 * which is the worst possible moment for it to fail.
 *
 * Note that the argument that made six months cheap for the order token does
 * **not** hold here, and this is the honest difference. There, the mail already
 * contained the claim code in its body, so a long-lived token in that same mail
 * widened no exposure the mail did not already carry. Here the mail contains a
 * link and not the abstract, so the token genuinely does widen exposure beyond
 * the message. Twelve months rather than forever is the concession: a URL that
 * surfaces out of an old inbox in 2029 is dead, not live.
 *
 * **Revocation: none in the token, by design.** Nothing is stored, so there is
 * no per-token kill switch, and the only blunt instrument is rotating
 * `WEB_SUBMISSION_SECRET`, which invalidates every outstanding link at once.
 * A stored nonce list would re-introduce exactly the state this scheme exists
 * to avoid, and in phases 1–5 nothing triggers a single-link revocation: the
 * answer to "I lost my link" is to re-send it to the address on file, and a
 * re-mint costs nothing and does not need the old one dead.
 *
 * If per-submission revocation is ever wanted, it needs no change to this file
 * and no new field. `iat` is already in the payload; put a `tokensValidFrom`
 * date on the submission document and have the caller reject a token minted
 * before it. "Re-send my link and kill the old one" then becomes one field
 * write. ⚠️ The caller does that check, not this file — same division of labour
 * as the deadline.
 *
 * **The accepted threat, plainly: this token is a bearer credential for one
 * author's unpublished work, for up to a year.** Whoever holds the URL can read
 * the abstract and, while the call is open, edit it. Bounded by four things: it
 * reaches exactly one submission and nothing adjacent — no other submission, no
 * review, no reviewer name, no list; it is not a sign-in credential and mints no
 * `registered` claim, so it cannot become an account; it is unguessable and
 * unenumerable, because forging one requires the HMAC key; and it dies within
 * twelve months whatever happens. **Not** accepted, and closed by keeping the
 * payload opaque: disclosure of the author's address, and confirmation that a
 * given person submitted at all.
 */

/**
 * How long a submission link stays usable. Exported because the mail that
 * carries the link should be able to say so, and a second copy of "twelve
 * months" in a template is a sentence that will one day be wrong.
 */
export const SUBMISSION_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export interface SubmissionTokenPayload {
  /** Token family. Always `'sub'`; see the note on shared secrets above. */
  t: 'sub';
  /**
   * The `submissions/{id}` document id — a minted, opaque id, never anything
   * derived from the author's address.
   */
  sid: string;
  /** Issued-at, epoch ms. */
  iat: number;
}

function secret(): string {
  /*
   * Its own variable with a fallback, exactly as the unsubscribe and consent
   * tokens have, and for the reason `consent-token.ts` gives: `WEB_ORDER_SECRET`
   * is documented as rotatable, and a rotation that also silently killed every
   * outstanding submission link would be discovered as "the call stopped getting
   * submissions", weeks later, with nothing in any log to say why. Falling back
   * rather than throwing because the alternative is a deployment that forgot one
   * variable mailing links that 404 — which is worse than sharing a key between
   * families that `t` already keeps apart.
   */
  const s = process.env.WEB_SUBMISSION_SECRET ?? process.env.WEB_ORDER_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      'Neither WEB_SUBMISSION_SECRET nor WEB_ORDER_SECRET is set (or one is too short). ' +
        'One of them signs abstract submission links; without it an author cannot be sent a ' +
        'way back to their own draft. Generate one with: openssl rand -base64 32',
    );
  }
  return s;
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

/**
 * Mints a link for one submission.
 *
 * ⚠️ `iat` is a native `Date` reduced to epoch ms, never a Firestore sentinel.
 * `@kgc/scripts` resolves its own copy of `firebase-admin`, and a
 * `Timestamp`/`FieldValue` built here and handed to a store created in
 * `apps/web` fails the entire write on an `instanceof` check — AGENTS.md
 * gotcha 8, which took the purchase flow down in August 2026 and which the
 * tests did not catch, because they resolve a single copy.
 */
export function mintSubmissionToken(submissionId: string): string {
  const payload: SubmissionTokenPayload = { t: 'sub', sid: submissionId, iat: Date.now() };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Returns null for anything tampered with, malformed, of the wrong family or expired. */
export function readSubmissionToken(token: string): SubmissionTokenPayload | null {
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
    ) as SubmissionTokenPayload;
    if (parsed.t !== 'sub') return null;
    if (typeof parsed.sid !== 'string' || !parsed.sid) return null;
    if (typeof parsed.iat !== 'number' || !Number.isFinite(parsed.iat)) return null;
    if (Date.now() - parsed.iat > SUBMISSION_TOKEN_TTL_MS) return null;
    return { t: 'sub', sid: parsed.sid, iat: parsed.iat };
  } catch {
    return null;
  }
}
