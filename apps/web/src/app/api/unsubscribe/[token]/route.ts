import { readUnsubscribeToken } from '@/lib/unsubscribe-token';
import { unsubscribeContact } from '@/lib/unsubscribe';
import { oneClickStatus } from '@/lib/unsubscribe-outcome';

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

  /*
   * A contact that no longer exists comes back as `gone` and answers 204: it is
   * on no audience. A write that failed answers 503 (T258 #11). It used to
   * answer 204 too, and the reader's mail client told them they were
   * unsubscribed while they stayed on every list.
   */
  let result: Awaited<ReturnType<typeof unsubscribeContact>> | 'error';
  try {
    result = await unsubscribeContact(payload.cid);
  } catch (err) {
    console.error('[unsubscribe] one-click POST could not record the unsubscribe', err);
    result = 'error';
  }

  // RFC 8058 asks for a 2xx and defines no body.
  return new Response(null, { status: oneClickStatus(result) });
}
