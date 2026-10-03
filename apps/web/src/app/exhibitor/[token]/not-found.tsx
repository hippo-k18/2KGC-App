import Link from 'next/link';
import { LostNode } from '@/components/lost-node';
import { SITE } from '@/lib/site';

/**
 * What booth staff see when their scanning link no longer opens.
 *
 * ── Why this route needs its own 404 ────────────────────────────────────────
 *
 * The site's 404 explained that order confirmation links expire because they
 * show a claim code. Stand staff whose link had been stopped got that sentence
 * — the wrong subject entirely — and no way to ask for another. They are
 * standing at a table with a phone and a queue of people, which is the worst
 * possible moment to be handed an explanation about somebody else's ticket.
 *
 * Three things can put somebody here and all three have the same answer: the
 * organizers stopped the link, the link is older than four months, or it was
 * mistyped. So the page does not guess which; it says the link no longer opens
 * and gives them the one thing that fixes every case.
 *
 * ⚠️ It must not say who the stand is or how many leads they have. This page
 * renders for a token that did not verify, which includes a forged one.
 */
export default function ExhibitorDeskNotFound() {
  return (
    <section className="notfound">
      <LostNode targetSelector=".notfound-links a" />
      <div className="wrap narrow">
        <p className="eyebrow">Lead desk</p>
        <h1>This link no longer opens</h1>
        <p className="lede">
          A stand&rsquo;s scanning link stops working when the organizers stop it, and every link
          stops after four months. The leads you have already taken are kept.
        </p>
        <p className="muted">
          Ask the organizers for a new link and this page will open again. They can send one to the
          address on your stand&rsquo;s record.
        </p>

        <div className="notfound-links">
          <a href={`mailto:${SITE.contactEmail}?subject=New lead desk link`}>Email the organizers</a>
          <Link href="/exhibitors">Exhibitors</Link>
          <Link href="/">Home</Link>
        </div>
      </div>
    </section>
  );
}
