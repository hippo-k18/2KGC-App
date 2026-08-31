'use server';

import { redirect } from 'next/navigation';
import { readUnsubscribeToken } from '@/lib/unsubscribe-token';
import { unsubscribeContact } from '@/lib/unsubscribe';

/**
 * The unsubscribe itself.
 *
 * A server action, which is a `POST`, and that is the entire reason this is not
 * simply done in the page's `GET`. The dashboard's own toggle carries the same
 * note: a link that unsubscribes on `GET` is one prefetch away from a corporate
 * mail scanner — Outlook Safe Links, a spam filter following every URL in a
 * message — unsubscribing an entire list on the sender's behalf. And because
 * there is deliberately no public re-subscribe (see `lib/unsubscribe.ts`), an
 * accidental unsubscribe is permanent until a human fixes it in the dashboard.
 *
 * The token is re-verified here rather than trusted from the form. A server
 * action is a public endpoint like any other; the page having verified it does
 * not mean this invocation came from that page.
 */
export async function unsubscribeAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const payload = readUnsubscribeToken(token);

  /*
   * A forged token lands on the same page a valid one does, which then 404s on
   * its own `readUnsubscribeToken`. Redirecting rather than throwing keeps the
   * two indistinguishable from outside — there is no oracle here that tells an
   * attacker whether a guessed token was well-formed.
   */
  if (!payload) redirect(`/u/${encodeURIComponent(token)}`);

  try {
    await unsubscribeContact(payload.cid);
  } catch (err) {
    /*
     * The contact was deleted between the mail going out and this click. The
     * reader is on no list, so the outcome they asked for is already true and
     * telling them it failed would be both alarming and wrong. Logged, because
     * it is worth knowing it happened.
     */
    console.error('[unsubscribe] could not record the unsubscribe', err);
  }

  redirect(`/u/${encodeURIComponent(token)}?done=1`);
}
