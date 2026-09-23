import 'server-only';

import { cookies } from 'next/headers';
import { COLLECTIONS, EVENT_ID, type RegistrationDoc } from '@kgc/shared';
import { readOrderToken } from '@/lib/order-token';
import { db } from '@/lib/firestore';

/**
 * Which ticket the person reading this page holds, on a site with no accounts.
 *
 * ── The problem, stated plainly ─────────────────────────────────────────────
 *
 * Streams and recordings are sold with a ticket, so a page that shows one has
 * to know which ticket the reader bought. The attendee app knows: it has
 * Firebase Auth, a `registered` claim and `firestore.rules`. This website has
 * none of that and deliberately so — it holds the Admin SDK and renders every
 * page on the server, with no Firebase credential in the browser at all
 * (`AGENTS.md`, and the header of `data.ts`). There is no signed-in visitor
 * here and adding one would mean building a second identity system in front of
 * a marketing site.
 *
 * ── What is used instead, and why it is not a new credential ────────────────
 *
 * The buyer already holds exactly one bearer capability for their own
 * registration: the `/order/{token}` link in their confirmation email. This
 * stores **that same token** in an HttpOnly cookie when they ask for it, and
 * reads it back on a session page to resolve their ticket type. Nothing new is
 * minted, nothing new is signed, and no new thing can be stolen: whoever can
 * set this cookie could already open the confirmation page, which carries the
 * claim code and the QR.
 *
 * Three consequences worth being explicit about, because they are the reasons
 * this is honest rather than a pretend login:
 *
 *   · **It is a device, not an identity.** The page says "this device" and
 *     never "you are signed in", because the cookie proves possession of a
 *     forwarded URL and nothing more. Forgetting it is one button.
 *   · **It buys nothing the link did not already buy.** It is read for exactly
 *     one decision — may this reader watch — and it never appears in a form,
 *     an action that writes, or a page that shows the claim code.
 *   · **The ticket is re-read on every request**, never stored in the cookie.
 *     A refunded or transferred ticket stops working immediately, with no
 *     session to expire, because `status` is checked here and not at the moment
 *     the cookie was set.
 *
 * `HttpOnly` so no script can read it, `SameSite=Lax` so it survives following
 * a link from the confirmation email but is not sent on a cross-site POST, and
 * `Secure` off the local dev server only.
 */

export const TICKET_PASS_COOKIE = 'kgc_ticket';

/** Six months, matching the order token's own life. A cookie outliving the
 *  token it holds would be an invisible logout. */
const MAX_AGE_S = 180 * 24 * 60 * 60;

export interface TicketPass {
  registrationId: string;
  name: string;
  /**
   * `RegistrationDoc.ticketType` — the name, because that is what
   * `allowedTicketTypes` holds and what `firestore.rules` compares.
   */
  ticketType: string | null;
}

/**
 * Resolve the cookie to a live, active registration, or null.
 *
 * Null for every failure without distinguishing them — no cookie, a forged one,
 * an expired one, a registration that has been cancelled, one belonging to
 * another event. A page that said which would answer "does this address hold a
 * ticket?" to anybody who could set a cookie.
 */
export async function readTicketPass(): Promise<TicketPass | null> {
  try {
    const raw = (await cookies()).get(TICKET_PASS_COOKIE)?.value;
    if (!raw) return null;

    const payload = readOrderToken(raw);
    if (!payload) return null;

    const snap = await db().collection(COLLECTIONS.registrations).doc(payload.rid).get();
    if (!snap.exists) return null;

    const reg = snap.data() as RegistrationDoc;
    if (reg.eventId !== EVENT_ID) return null;
    /*
     * `active` and nothing else. A cancelled or transferred ticket keeps its
     * document — the badge is in circulation and the desk needs an answer (see
     * `cancelRegistration`) — so reading the document is not the same as
     * holding a valid ticket, and a refunded buyer must lose the video with the
     * money.
     */
    if (reg.status !== 'active') return null;

    return {
      registrationId: snap.id,
      name: reg.name?.trim() || reg.email,
      ticketType: reg.ticketType?.trim() || null,
    };
  } catch (err) {
    // Same treatment as every other read on this site: a store that cannot be
    // reached is "we do not know which ticket you hold", which is the safe
    // direction, rather than a 500 on a session page.
    console.error('[ticket-pass] could not resolve the pass cookie', err);
    return null;
  }
}

/**
 * Remember this order token on this device.
 *
 * Verified before it is stored, so a hand-typed cookie value never becomes a
 * stored one, and so the button can tell the buyer their link has expired
 * instead of appearing to work and failing later on another page.
 */
export async function setTicketPass(rawToken: string): Promise<boolean> {
  if (!readOrderToken(rawToken)) return false;

  (await cookies()).set(TICKET_PASS_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_S,
  });
  return true;
}

export async function clearTicketPass(): Promise<void> {
  (await cookies()).delete(TICKET_PASS_COOKIE);
}
