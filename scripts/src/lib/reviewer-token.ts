import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The capability token that unlocks one reviewer's assignment list.
 *
 * The same scheme as `order-token.ts`, `unsubscribe-token.ts`,
 * `consent-token.ts` and `submission-token.ts` — HMAC-SHA256 over a base64url
 * JSON body, the same `body.signature` shape, the same constant-time compare —
 * and it lives in this package for the same reason those do: the dashboard
 * mints the invitation and `apps/web` honours it, and neither app can import
 * the other. Read `submission-token.ts` first; this file is its sibling and
 * only the differences are argued here.
 *
 * ── Why a token rather than a login (CFA-PLAN §3) ───────────────────────────
 *
 * A reviewer is very often an external academic who will use this system twice
 * in their life: once to score a batch of abstracts, once to be thanked. Asking
 * that person to create an account, and then to remember a password eleven
 * months later for the next call, is how a programme committee loses reviewers.
 * Token-first also keeps the `roles` claim meaning what it means today —
 * `reviewers/{id}` is deliberately **not** `users`, because a reviewer need not
 * hold a ticket and must not be handed the `registered` claim to get one.
 *
 * ⚠️ If reviewers later need a real session — a persistent dashboard, saved
 * filters, anything stateful — they become a `roles: ['reviewer']` claim and the
 * minting path already exists in `scripts/src/set-claims.ts`. That is a
 * deliberate escalation, not a fallback, and it is not what this file is.
 *
 * ── What holding this token lets you do ─────────────────────────────────────
 *
 * Read **one reviewer's** assignment list, read the submissions on it, and write
 * **that reviewer's own** review on an assigned submission. Nothing else.
 *
 * ── What this token deliberately does NOT enforce ───────────────────────────
 *
 * **Score blinding.** CFA-PLAN §3 requires that a reviewer cannot see other
 * reviewers' scores on a submission until their own score is entered, and is
 * explicit that this "is a rule enforced server-side, not a UI preference". The
 * token cannot express it: whether you may read a sibling review depends on
 * whether *your* review document exists right now, which is a fact about
 * Firestore at read time and not a fact that can be signed into a URL.
 *
 * So: **the server action that reads `submissions/{id}/reviews/*` enforces it**,
 * by checking for this reviewer's own document before returning anybody else's.
 * ⚠️ There is no second line of defence behind that check. The CFA collections
 * are server-owned — no `match` block in `firestore.rules`, every read and write
 * through the Admin SDK, the same posture as `orders` (CFA-PLAN §2) — and the
 * Admin SDK bypasses rules entirely. Where the rest of this repo can lean on
 * `firestore.rules` as the security boundary, here the server action *is* the
 * boundary. Hiding the column in the review screen is not the control; deciding
 * not to send the number is.
 *
 * **Assignment.** The token names a reviewer, never a submission. Whether this
 * reviewer may touch submission X is read from the assignment list on
 * `reviewers/{id}` at request time, by the caller. Signing an assignment into
 * the URL would freeze it, and assignments are re-balanced, withdrawn on a
 * declared conflict of interest, and added to mid-round.
 *
 * **Conflict of interest.** A declared conflict removes an assignment. That is
 * a state change on a document, and an already-minted token must start failing
 * for that submission the moment it happens — which it does, because the caller
 * re-reads the assignment list every time and the token never asserted one.
 *
 * ── The payload, and what is deliberately absent ────────────────────────────
 *
 * `{ t, rvid, iat }`. The minted `reviewers/{id}` id and nothing else: no name,
 * no address, no affiliation, no assignment list, no call id — the same
 * reasoning as `submission-token.ts`, which is the badge-QR argument in
 * AGENTS.md applied to a URL. A reviewer's identity is the one thing a
 * double-blind-capable system must be most careful with (CFA-PLAN §1.1), and a
 * reviewer's address in a link is a reviewer's address in every log the request
 * touches.
 *
 * `rvid` rather than `rid` on purpose: `rid` is the order token's registration
 * id, and because every token file here falls back to `WEB_ORDER_SECRET` the
 * field names are effectively one shared namespace. Under a single deployed key
 * a body of `{ rid, iat }` would verify in both files. `t` is checked strictly
 * on read for the same reason, so a submission token can never be replayed as a
 * reviewer token and vice versa.
 *
 * ── Expiry and revocation, and the threat accepted ──────────────────────────
 *
 * **Expiry: six months — half the submission token's, deliberately.** This is
 * the higher-value credential of the two. A submission link reaches one author's
 * own work; a reviewer link reaches *many people's* unpublished work, plus the
 * ability to write scores that decide whether that work is accepted. It is also
 * far cheaper to replace: phase 3 gives organizers a reviewer reminder button,
 * and every reminder carries a freshly minted link, so the practical life of any
 * one URL is "since the last nudge" rather than the full TTL.
 *
 * Six rather than three months because a review round that slips is normal, and
 * a link that dies at 23:00 on the deadline for the one reviewer who left it
 * late is the failure `consent-token.ts` warns about — the cost lands entirely
 * on the volunteer and is invisible to the organizer.
 *
 * **Revocation: none in the token.** Stateless, so nothing individual can be
 * killed; rotating `WEB_REVIEWER_SECRET` kills every outstanding link at once.
 * Unlike a submission link, a reviewer link has a plausible reason to be revoked
 * singly — a reviewer resigns from the committee, or leaves under a cloud — and
 * the answer is the same one `submission-token.ts` describes and costs no change
 * here: `iat` is in the payload, so a `tokensValidFrom` date on `reviewers/{id}`
 * lets the caller reject anything minted before it. ⚠️ Again, the caller does
 * that; this file does not. Removing every assignment from the reviewer document
 * is the cruder version that already works today, and leaves an audit trail.
 *
 * **The accepted threat, plainly: this token is a bearer credential for one
 * reviewer's seat on the committee, for up to six months.** Whoever holds the
 * URL can read every abstract assigned to that reviewer and file scores in their
 * name. Bounded by four things: it reaches one reviewer's assignments and
 * nothing wider — not the full submission list, not the decisions, not other
 * reviewers' scores before the holder has scored; it is not a sign-in credential
 * and mints no claim, so it cannot become an account or an organizer; it is
 * unguessable and unenumerable, since forging one requires the HMAC key; and the
 * writes it permits are attributed and overwritable — a review lands at
 * `reviews/{reviewerId}`, so a forged score is visible to an organizer as that
 * reviewer's score and can be replaced. **Not** accepted, and closed by keeping
 * the payload opaque and the assignment list server-side: disclosure of the
 * reviewer's identity from the URL, and enumeration of the submission pool.
 */

/**
 * How long a reviewer link stays usable. Exported so the invitation and reminder
 * mail can say so without a second copy of the number.
 */
export const REVIEWER_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export interface ReviewerTokenPayload {
  /** Token family. Always `'rev'`; see the note on shared secrets above. */
  t: 'rev';
  /** The `reviewers/{id}` document id — minted and opaque, never an address. */
  rvid: string;
  /** Issued-at, epoch ms. */
  iat: number;
}

function secret(): string {
  /*
   * Its own variable with a fallback, for the reason `consent-token.ts` gives:
   * `WEB_ORDER_SECRET` is documented as rotatable, and a rotation that silently
   * killed every outstanding reviewer link would surface as "the reviews stopped
   * coming in", days before a decision meeting, with no error anywhere. Falling
   * back rather than throwing because a deployment that forgot one variable
   * would otherwise invite a whole committee to links that 404.
   */
  const s = process.env.WEB_REVIEWER_SECRET ?? process.env.WEB_ORDER_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      'Neither WEB_REVIEWER_SECRET nor WEB_ORDER_SECRET is set (or one is too short). ' +
        'One of them signs reviewer invitation links; without it a reviewer cannot be given ' +
        'their assignments. Generate one with: openssl rand -base64 32',
    );
  }
  return s;
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

/**
 * Mints a link for one reviewer.
 *
 * ⚠️ `iat` is a native `Date` reduced to epoch ms, never a Firestore sentinel —
 * AGENTS.md gotcha 8. `@kgc/scripts` resolves its own `firebase-admin`, and a
 * `Timestamp`/`FieldValue` built here fails the `instanceof` check inside a
 * store created in `apps/web`, taking the whole write down.
 */
export function mintReviewerToken(reviewerId: string): string {
  const payload: ReviewerTokenPayload = { t: 'rev', rvid: reviewerId, iat: Date.now() };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Returns null for anything tampered with, malformed, of the wrong family or expired. */
export function readReviewerToken(token: string): ReviewerTokenPayload | null {
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
    ) as ReviewerTokenPayload;
    if (parsed.t !== 'rev') return null;
    if (typeof parsed.rvid !== 'string' || !parsed.rvid) return null;
    if (typeof parsed.iat !== 'number' || !Number.isFinite(parsed.iat)) return null;
    if (Date.now() - parsed.iat > REVIEWER_TOKEN_TTL_MS) return null;
    return { t: 'rev', rvid: parsed.rvid, iat: parsed.iat };
  } catch {
    return null;
  }
}
