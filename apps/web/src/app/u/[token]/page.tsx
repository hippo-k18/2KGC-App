import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readUnsubscribeToken } from '@/lib/unsubscribe-token';
import { lookupContact } from '@/lib/unsubscribe';
import { SITE } from '@/lib/site';
import { unsubscribeAction } from './actions';

export const metadata: Metadata = {
  title: 'Unsubscribe',
  // Same treatment as `/order/{token}`: this URL is a capability, and a
  // capability in a search index is a capability anybody can exercise.
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export const dynamic = 'force-dynamic';

/**
 * `/u/{token}` — the public unsubscribe link.
 *
 * ── What the token buys ─────────────────────────────────────────────────────
 *
 * `contacts/{id}` is `contact_` + sha256 of the address, so an id-keyed URL
 * would be computable from any address somebody wants to try. That makes the
 * naive version two vulnerabilities at once: a membership oracle for the
 * marketing list, and a way to unsubscribe other people. The HMAC in
 * `lib/unsubscribe-token.ts` closes both — the same scheme `/order/{token}`
 * uses, minted by the sender, verifiable by nobody else.
 *
 * ── Why there is a button rather than a bare link that acts ─────────────────
 *
 * One-click is the standard and it is met twice over, but not by unsubscribing
 * on `GET`:
 *
 *   1. **RFC 8058.** Every campaign mail carries `List-Unsubscribe` pointing at
 *      `/api/unsubscribe/{token}` plus `List-Unsubscribe-Post`. Gmail and Apple
 *      Mail render their own Unsubscribe control from those and `POST` it
 *      themselves. That is the true one-click path and it never opens a page.
 *   2. **This page**, for every other client. One button, already addressed to
 *      the right contact — **nothing to type**, no address to confirm, no
 *      sign-in, no preference grid.
 *
 * Acting on `GET` would fail differently and much worse: mail scanners and link
 * prefetchers fetch every URL in a message, so a link that unsubscribed on
 * arrival would silently empty the list. The dashboard's own toggle carries the
 * same reasoning.
 *
 * ── The confirmation says less than it is tempting to say ───────────────────
 *
 * ⚠️ "You will not receive further emails" would be false. `audienceFor()` in
 * the dashboard drops `unsubscribedAt` from every *campaign* audience, and that
 * is the promise that is actually kept. Receipts, claim codes and mail about a
 * session somebody is speaking at are resolved from other collections and are
 * not marketing in any jurisdiction. So the page promises campaign mail stops,
 * names what does not, and stops there.
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;

  const payload = readUnsubscribeToken(decodeURIComponent(token));
  if (!payload) notFound();

  const contact = await lookupContact(payload.cid);

  /*
   * The three states this page has, and they are genuinely different claims:
   *
   *   `gone`  — no contact document. Nothing to unsubscribe, and nothing will
   *             be sent, because every campaign audience is resolved from that
   *             collection. Reached by a link older than a deletion.
   *   `off`   — recorded, either just now or previously.
   *   `on`    — still subscribed; the button is the only thing on the page.
   */
  const state = !contact ? 'gone' : contact.alreadyUnsubscribed || done === '1' ? 'off' : 'on';

  return (
    <section>
      <div className="wrap narrow">
        <p className="eyebrow">Email preferences</p>

        {state === 'on' && (
          <>
            <h1>Unsubscribe from KGC email</h1>
            <p className="lede">
              This will stop campaign and announcement email to{' '}
              <strong>{contact!.email}</strong>.
            </p>
            {contact!.lists.length > 0 && (
              <p className="muted">
                {contact!.lists.length === 1 ? 'You are on the list ' : 'You are on the lists '}
                {contact!.lists.map((l, i) => (
                  <span key={l}>
                    {i > 0 && ', '}
                    <strong>{l}</strong>
                  </span>
                ))}
                . Unsubscribing removes you from all of them.
              </p>
            )}

            {/*
              A form, not a link — see the page docblock. The token round-trips
              through a hidden field and is verified again in the action, because
              a server action is a public endpoint and cannot trust its caller.
            */}
            <form action={unsubscribeAction} style={{ margin: '24px 0 0' }}>
              <input type="hidden" name="token" value={token} />
              <button type="submit" className="btn btn-primary">
                Unsubscribe
              </button>
            </form>

            <p className="muted" style={{ marginTop: 20 }}>
              Nothing has changed yet — this takes effect when you press the button.
            </p>
          </>
        )}

        {state === 'off' && (
          <>
            <h1>{done === '1' ? 'Done — you’re unsubscribed.' : 'You’re already unsubscribed.'}</h1>
            <p className="lede">
              <strong>{contact!.email}</strong> has been removed from our campaign mailing lists.
              You will not receive marketing or announcement email from the Knowledge Graph
              Conference.
            </p>
            {/*
              The exception, stated plainly rather than buried. Somebody who
              unsubscribes and then receives their own ticket receipt will
              otherwise reasonably conclude the unsubscribe did not work, and
              report the receipt as spam — which is the outcome the whole
              suppression list exists to prevent.
            */}
            <p>
              Email about something you hold — a ticket, an order, a receipt, or a session you are
              speaking at — is not marketing and still reaches you. There is nothing to unsubscribe
              from there; those are sent only to the person they concern.
            </p>
            <p className="muted">
              Changed your mind? We deliberately have no one-click way back on, because a link that
              could re-subscribe you is a link somebody else could use to do it. Email{' '}
              <a href={`mailto:${SITE.contactEmail}?subject=Re-subscribe`}>{SITE.contactEmail}</a>{' '}
              and we will add you back by hand.
            </p>
          </>
        )}

        {state === 'gone' && (
          <>
            <h1>You’re not on any of our lists.</h1>
            <p className="lede">
              This address is not on a Knowledge Graph Conference mailing list, so there is nothing
              to unsubscribe from and no campaign email will be sent to it.
            </p>
            <p className="muted">
              That is usually because the list was already cleared. If you are still receiving mail
              you did not ask for, tell us at{' '}
              <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and we will find it.
            </p>
          </>
        )}

        <p className="muted" style={{ marginTop: 32 }}>
          <Link href="/">Back to {SITE.shortName} {SITE.year}</Link>
        </p>
      </div>
    </section>
  );
}
