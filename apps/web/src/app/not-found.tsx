import Link from 'next/link';
import { LostNode } from '@/components/lost-node';

/**
 * A 404 that is a node with no edges.
 *
 * The four links below are the nodes this one can attach to; hovering or
 * focusing any of them draws the edge. It is the only page on the site where the
 * illustration and the task are the same gesture — reconnecting the graph is
 * literally what the page is asking you to do.
 */
export default function NotFound() {
  return (
    <section className="notfound">
      <LostNode targetSelector=".notfound-links a" />
      <div className="wrap narrow">
        <p className="eyebrow">404</p>
        <h1>This node has no edges</h1>
        <p className="lede">
          That page does not exist. If you followed an order confirmation link, it may simply have
          expired — those are deliberately short-lived, because they show a claim code.
        </p>
        <p className="muted">Anything below will reconnect you.</p>

        <div className="notfound-links">
          <Link href="/">Home</Link>
          <Link href="/agenda">Agenda</Link>
          <Link href="/speakers">Speakers</Link>
          <Link href="/tickets">Tickets</Link>
        </div>
      </div>
    </section>
  );
}
