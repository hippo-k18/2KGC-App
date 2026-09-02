'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readConsentToken } from '@kgc/scripts/src/lib/consent-token';
import { recordSignature } from '../store';

/**
 * Signing.
 *
 * A server action, which is a `POST`, and that is not incidental: a consent
 * recorded on `GET` would be recorded by every corporate mail scanner that
 * follows the links in a message. Outlook Safe Links would sign every speaker's
 * release the moment the invitation arrived, and a signature nobody gave is
 * worse than a signature nobody has — it is the one failure this whole feature
 * exists to prevent, dressed as success.
 *
 * The token is re-verified here rather than trusted from the form. A server
 * action is a public endpoint like any other; the page having verified it says
 * nothing about who invoked this.
 *
 * ── The subject comes from the token and never from the form ────────────────
 *
 * The only thing this action reads out of `formData` is the typed name. Who is
 * signing, and which form, are both inside the HMAC — so a request that names
 * somebody else in a field changes nothing about who is recorded.
 */
export async function signConsentAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const signedName = String(formData.get('signedName') ?? '');

  const payload = readConsentToken(token);

  /*
   * A forged token redirects to the same page a valid one does, which then
   * 404s on its own verification. Redirecting rather than throwing keeps the
   * two indistinguishable from outside: there is no oracle here telling an
   * attacker whether a guessed token was well-formed.
   */
  if (!payload) redirect(`/consent/${encodeURIComponent(token)}`);

  /*
   * The two corroborating details, and the reason they are collected *here*
   * rather than sent up by the page.
   *
   * This is the channel with no account behind it. A speaker signing through a
   * mailed link is authenticated by nothing except possession of the link, so
   * the only other evidence that a real person did this at a real moment is
   * what the server itself observed: the address the request came from and the
   * browser that made it. Both are weak — a proxy's address, a shared network,
   * a user agent anybody can set — and `ConsentResponseDoc` says so in place
   * rather than letting the register imply they identify anybody.
   *
   * They are deliberately not collected on the in-app path, where the uid is
   * stronger evidence than either and a client cannot be asked to report its
   * own IP address without being able to report any address it likes.
   *
   * `x-forwarded-for` is a list; the first hop is the client as the nearest
   * proxy saw it. Netlify sets it, and `x-nf-client-connection-ip` beside it.
   */
  const h = await headers();
  const forwarded = h.get('x-forwarded-for') ?? '';
  const ip =
    forwarded.split(',')[0]?.trim() || h.get('x-nf-client-connection-ip')?.trim() || undefined;
  const userAgent = h.get('user-agent') ?? undefined;

  let outcome: string;
  try {
    outcome = await recordSignature({
      formId: payload.fid,
      sub: payload.sub,
      signedName,
      ip,
      userAgent,
    });
  } catch (err) {
    /*
     * Logged rather than swallowed into a success page. Unlike an unsubscribe —
     * where the reader's desired outcome may already be true — there is no
     * benign reading of a failed consent write, and telling somebody their
     * release was recorded when it was not is the exact lie this screen must
     * never tell.
     */
    console.error('[consent] could not record the signature', err);
    outcome = 'error';
  }

  redirect(`/consent/${encodeURIComponent(token)}?r=${outcome}`);
}
