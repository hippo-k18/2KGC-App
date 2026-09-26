import Link from 'next/link';
import { LostNode } from '@/components/lost-node';
import { siteVisibility } from '@/lib/data';

/**
 * A 404 that is a node with no edges.
 *
 * The four links below are the nodes this one can attach to; hovering or
 * focusing any of them draws the edge. It is the only page on the site where the
 * illustration and the task are the same gesture — reconnecting the graph is
 * literally what the page is asking you to do.
 */
export default async function NotFound() {
  const show = await siteVisibility();
  return (
    <section className="notfound">
      <LostNode targetSelector=".notfound-links a" />
      <div className="wrap narrow">
        <p className="eyebrow">404</p>
        <h1>This node has no edges</h1>
        {/*
          ⚠️ This used to read "Order confirmation links expire, because they
          show a claim code." Six kinds of one-off link land here — an order,
          a speaker profile, a reviewer's queue, a consent form, a mailing
          preference, a stand's scanning desk — and all six were told they had
          followed an order confirmation. The stand staff whose link had just
          been stopped got an explanation about claim codes. The general page
          says the general thing; a route with something better to say carries
          its own, as `exhibitor/[token]` now does.
        */}
        <p className="lede">
          That page does not exist. A link we sent you may also have stopped working, since most of
          them are meant to be used once.
        </p>
        <p className="muted">Anything below will reconnect you.</p>

        <div className="notfound-links">
          <Link href="/">Home</Link>
          {show.agenda && <Link href="/agenda">Agenda</Link>}
          {show.speakers && <Link href="/speakers">Speakers</Link>}
          <Link href="/tickets">Tickets</Link>
        </div>
      </div>
    </section>
  );
}
