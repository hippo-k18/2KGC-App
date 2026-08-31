import { readUnsubscribeToken } from '@/lib/unsubscribe-token';
import { unsubscribeContact } from '@/lib/unsubscribe';

/**
 * `POST /api/unsubscribe/{token}` — RFC 8058 one-click unsubscribe.
 *
 * This is the endpoint named in every campaign mail's `List-Unsubscribe`
 * header, alongside `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Gmail
 * and Apple Mail read those two headers and render their own Unsubscribe
 * control beside the sender's name; pressing it makes the *mail client* send
 * this POST, with the body `List-Unsubscribe=One-Click`. The reader never
 * leaves their inbox. Since 2024 both Google and Yahoo require this of anyone
 * sending bulk mail at volume.
 *
 * ── Why this is a separate path from `/u/{token}` ───────────────────────────
 *
 * One App Router segment cannot be both a `page.tsx` and a `route.ts`, and the
 * two want opposite things anyway: `/u/{token}` must answer a `GET` with a
 * human page, this must answer a `POST` with nothing at all. The
 * `List-Unsubscribe` header may name a different URL from the link in the body,
 * which is exactly what that allowance is for.
 *
 * ── There is deliberately no GET handler ────────────────────────────────────
 *
 * Only `POST` is exported, so a mail scanner following the header as a link
 * gets a 405 and nobody is unsubscribed by a prefetch. A client that honours
 * `List-Unsubscribe` but not the POST convention falls back to the `mailto:`
 * that the same header carries as its second value.
 */

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  const payload = readUnsubscribeToken(decodeURIComponent(token));

  /*
   * 404 rather than 400, and no body either way. A mail client shows the reader
   * nothing but success or failure, so a descriptive error reaches nobody who
   * could act on it — while a response that distinguished "malformed" from
   * "bad signature" would tell somebody probing the endpoint which of their
   * guesses was closer.
   */
  if (!payload) return new Response(null, { status: 404 });

  try {
    await unsubscribeContact(payload.cid);
  } catch (err) {
    /*
     * The contact is gone, so it is on no audience and the reader's intent is
     * already satisfied. Answering 200 is correct and also practical: a non-2xx
     * makes some clients re-offer the button, and a reader who presses
     * unsubscribe twice with no effect reaches for the spam button instead.
     */
    console.error('[unsubscribe] one-click POST could not record the unsubscribe', err);
  }

  // RFC 8058 asks for a 2xx and defines no body.
  return new Response(null, { status: 204 });
}
