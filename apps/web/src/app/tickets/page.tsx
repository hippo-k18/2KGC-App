import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import { tiersOrNull } from '@/lib/catalogue';
import type { TicketId } from '@/lib/tickets';
import { demoCheckoutAllowed } from '@/lib/demo-checkout';
import { stripeEnabled } from '@/lib/stripe';
import { activeForm } from '@/lib/question-forms';
import { CheckoutForm } from './checkout-form';
import { TierCard } from './tier-card';

export const metadata: Metadata = {
  title: 'Tickets',
  description:
    'All Access, Main Conference, Workshops and Virtual tickets for the Knowledge Graph Conference 2027.',
};

/**
 * `stripeEnabled()` reads an environment variable, so this page cannot be
 * statically prerendered — a build-time snapshot would bake in whichever mode
 * the build machine happened to be in.
 */
export const dynamic = 'force-dynamic';

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  const params = await searchParams;

  /**
   * The catalogue is read once here and threaded down, rather than looked up
   * per panel. It now comes from Firestore, so each `tierById` call would be a
   * network round trip — and the checkout form is a client component that
   * cannot read Firestore at all, so it needs the tiers as props regardless.
   */
  const [catalogue, form] = await Promise.all([tiersOrNull(), activeForm('attendee')]);

  /**
   * `null` means the catalogue could not be read at all — no credentials, or
   * the database is unreachable. That is not the same as having no tickets, and
   * it must never be rendered as a price. The page keeps its heading and its FAQ,
   * and says plainly that sales are not open rather than returning a 500.
   */
  const tiers = catalogue ?? [];
  const byId = new Map(tiers.map((t) => [t.id, t]));

  const preselected = (byId.has(params.tier ?? '') ? params.tier! : tiers[0]?.id) as TicketId;

  return (
    <>
      {/*
        No hero.

        This page used to open on a full-bleed navy band: an orange kicker, the
        conference name set at display size, the dates, two calls to action, a
        line of starred copy and a photograph of three attendees — a little over
        a screen's worth of height in front of somebody who has already told us
        what they came for by clicking "Tickets". Both of its buttons pointed
        further down this same page.

        What replaces it is a heading and one line of orientation, on the page's
        own ground rather than in a coloured band, so the first ticket price is
        visible without scrolling.
      */}
      <section className="band tickets-head">
        <div className="wrap">
          <h1>Tickets</h1>
          <p>
            {SITE.datesLong} at {SITE.venueShort}.
          </p>

          {params.cancelled && (
            <p className="notice warn">Checkout was cancelled. Nothing was charged.</p>
          )}
        </div>
      </section>

      {/*
        Every tier in one grid.

        There were two bands here: the tiers marked `featured` as wide panels
        under "Main Ticket Types", then everything else as narrow cards on a
        navy band under "Smaller tickets, big impact." That second band is where
        the pinched columns came from — centred text in a 240px track — and
        between them the two headings, two ledes and two footnotes said little
        that the cards do not.

        `featured` still decides something, and it is now the only thing that
        distinguishes a tier visually: a featured card gets the filled button
        and a slightly stronger edge, the rest get outlined buttons. Hierarchy
        by weight rather than by a badge.
      */}
      {/*
        Skipped entirely rather than rendered empty. An unreadable catalogue is
        a real state — no credentials, or Firestore unreachable — and a band
        with 92px of padding and nothing in it reads as a layout that broke,
        which is a worse answer than the checkout's own "Registration is not
        open yet" further down.
      */}
      {tiers.length > 0 && (
        <section className="band tickets-band">
          <div className="wrap">
            <div className="tier-grid">
              {tiers.map((t) => (
                <TierCard key={t.id} tier={t} href={`/tickets?tier=${t.id}#buy`} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/*
        Ours, and not on the live site, which hands checkout to a third party.
        It stays because it is the only place on this site where a ticket is
        actually bought.

        The `id` lives here and nowhere else. It used to be on this section *and*
        on the `<form>` inside it — two elements with `id="buy"` in one document,
        so every `#buy` link on the page was resolving to whichever the browser
        found first and `getElementById` was a coin toss.
      */}
      <section className="band buy-band" id="buy">
        <div className="wrap">
          {catalogue && catalogue.length > 0 ? (
            <CheckoutForm
              tiers={tiers}
              initialTier={preselected}
              stripeReady={stripeEnabled()}
              demoReady={await demoCheckoutAllowed()}
              questions={form.fields}
            />
          ) : (
            <div className="checkout checkout-closed">
              <h2 style={{ fontSize: '1.4rem' }}>Registration is not open yet</h2>
              <p className="notice warn">
                Ticket sales for {SITE.name} have not opened. Everything else on this page is
                current.
              </p>
              <p>
                Write to <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and we
                will tell you the moment they do.
              </p>
            </div>
          )}
        </div>
      </section>

      {/*
        The route from paying to standing in the room, as a strip rather than an
        essay, and it sits below the purchase rather than in front of it.

        This content used to be four numbered paragraphs stacked beside the
        checkout form, which put several hundred words of explanation in direct
        competition with the one control on the page that takes money. It is a
        genuine sequence — each step is only true once the one before it has
        happened — so it keeps its numbers, but it earns them in one line each
        and it sits above the form rather than next to it.
      */}
      <section className="band band-wash flow-band">
        <div className="wrap">
          <h2 className="flow-title">From paying to standing in the room</h2>
          <ol className="flow-strip">
            <li>
              <strong>Register</strong>
              Pick a ticket, and give us the attendee’s name and email address.
            </li>
            <li>
              <strong>Keep the claim code</strong>
              Six characters, shown the moment you pay. Use it if you cannot sign in.
            </li>
            <li>
              <strong>Open the KGC app</strong>
              Sign in with the same address. The schedule, messages and contacts are already there.
            </li>
            <li>
              <strong>Scan in at the door</strong>
              Your badge QR carries a random secret, not your name.
            </li>
          </ol>
        </div>
      </section>

      {/*
        The questions, below the purchase rather than beside it.

        Every one of these was a bold-lead paragraph in a column running down the
        side of the checkout form, where a buyer had to read past all five to
        reach the thing they came for. As collapsed rows they take a tenth of the
        height, they are scannable by question, and the one a particular person
        needs is one click away instead of four paragraphs down.
      */}
      <section className="band-wash">
        <div className="kgc-faq">
          <h2>Questions</h2>

          <details>
            <summary>Can I transfer my ticket to someone else?</summary>
            <div className="answer">
              <p>
                Yes, up to a week before the conference. Mail{' '}
                <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> with the new
                attendee’s details and we will move the registration.
              </p>
            </div>
          </details>

          <details>
            <summary>Is there a student rate?</summary>
            <div className="answer">
              <p>Yes. Write to us from your institutional address before you buy.</p>
            </div>
          </details>

          <details>
            <summary>Do virtual tickets include the recordings?</summary>
            <div className="answer">
              <p>Yes. Every session, on demand, for at least a month after the conference.</p>
            </div>
          </details>

          <details>
            <summary>What if I use a different email address at work?</summary>
            <div className="answer">
              <p>
                Sign in with either and use the claim code from your confirmation page. We can
                attach alternate addresses to one registration.
              </p>
            </div>
          </details>

          <details>
            <summary>Can we pay by invoice?</summary>
            <div className="answer">
              <p>
                Yes. <Link href="/tickets/invoice">Request one here</Link>. Net-14 to net-60 terms,
                with a PO number on the invoice.
              </p>
            </div>
          </details>
        </div>
      </section>

      {/* The live site closes every page of this kind with "Find us". */}
      <section className="band">
        <div className="wrap">
          <div className="find-us">
            <h2>Find us</h2>
            <div className="cols">
              <div>
                <p className="k">Email</p>
                <p className="v">
                  <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
                </p>
              </div>
              <div>
                <p className="k">Address</p>
                <p className="v">Cornell Tech &amp; globally online</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
