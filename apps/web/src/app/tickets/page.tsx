import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import { tiersOrNull } from '@/lib/catalogue';
import { formatPrice, type Tier, type TicketId } from '@/lib/tickets';
import { stripeEnabled } from '@/lib/stripe';
import { activeForm } from '@/lib/question-forms';
import { CheckoutForm } from './checkout-form';

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

/**
 * The live site's headline ticket panel: a centred card, one navy and one pale,
 * with underlined group headings above bulleted contents. Falls back to the
 * flat `includes` list for a tier that carries no groups.
 *
 * The price is printed in the tier's own currency and the call to action is
 * gated on `onSale` — both were missing here while `audience-page.tsx` had them
 * right, which made this page the outlier rather than the pattern. A tier
 * priced in EUR printed a dollar sign over a euro amount while Stripe charged
 * euros, and a sold-out tier kept advertising a live button that the checkout
 * radio then refused two scroll-lengths further down.
 */
function TicketPanel({ tier, tone }: { tier: Tier; tone: 'dark' | 'light' }) {
  const groups = tier.groups ?? [{ heading: 'Includes', items: [...tier.includes] }];

  return (
    <div className={`kgc-ticket ${tone}`}>
      <h3>{tier.name}</h3>
      <p className="price">{formatPrice(tier.priceCents, tier.currency)}</p>

      {/*
        `TicketTypeDoc.tagline` describes itself as "one line under the price on
        the tickets page", the order rail renders it and `audience-page.tsx:119`
        renders it — and this panel, the one the doc names, did not. An organizer
        editing that field on the two flagship tiers changed nothing anybody saw.
      */}
      {tier.tagline && <p className="tagline">{tier.tagline}</p>}

      {groups.map((g) => (
        <div key={g.heading}>
          <p className="group">{g.heading}</p>
          {g.items && (
            <ul>
              {g.items.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {tier.onSale ? (
        <Link
          href={`/tickets?tier=${tier.id}#buy`}
          className={`btn ${tone === 'dark' ? 'btn-accent' : 'btn-primary'}`}
        >
          Choose {tier.name}
        </Link>
      ) : (
        /*
          A closed tier still renders, for the reason `audience-page.tsx` gives:
          one that vanishes reads as a bug to somebody who was sent a link to
          it, and the reason it closed is the thing they actually need to know.
        */
        <p className="sold-out">{tier.unavailableReason ?? 'Not available'}</p>
      )}
    </div>
  );
}

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
   * it must never be rendered as a price. The page keeps its hero and its FAQ,
   * and says plainly that sales are not open rather than returning a 500.
   */
  const tiers = catalogue ?? [];
  const byId = new Map(tiers.map((t) => [t.id, t]));

  const preselected = (byId.has(params.tier ?? '') ? params.tier! : tiers[0]?.id) as TicketId;

  /**
   * Which two tiers get the headline panels.
   *
   * This used to name `all-access` and `main-conference` as literal slugs, so
   * `TicketTypeDoc.featured` — a field the dashboard's ticket editor writes and
   * whose entire purpose is this decision — chose nothing here. Marking a new
   * tier featured moved it nowhere, and deleting one of the two named tiers
   * demoted whatever replaced it to the small cards.
   *
   * The layout is still bespoke to a pair: one dark panel and one light, side
   * by side. So it takes the first two featured tiers in catalogue order, and
   * falls back to the first two tiers when nothing is marked — a page with a
   * headline band and nothing in it would be a worse answer to an unmigrated
   * catalogue than showing the two tiers that sort first.
   *
   * One featured tier renders one panel and everything else falls to the small
   * cards below, which is the correct reading of "feature this one".
   */
  const featured = tiers.filter((t) => t.featured);
  const [headlineA, headlineB] = featured.length > 0 ? featured : tiers;
  const smaller = tiers.filter((t) => t.id !== headlineA?.id && t.id !== headlineB?.id);

  return (
    <>
      {/*
        The live page opens on a dark band: orange kicker, the conference name,
        the dates, a call to action, and a photograph bleeding off the right.
      */}
      <section className="band band-navy">
        <div className="wrap split-hero">
          <div>
            <p className="kicker">Tickets for</p>
            <h1>{SITE.name}</h1>
            <p className="when">
              {SITE.datesLong} | {SITE.venueShort}
            </p>
            <div className="cta">
              <Link href="#buy" className="btn btn-accent">
                Register now
              </Link>
              <Link href="/agenda" className="btn btn-ghost">
                See the agenda
              </Link>
            </div>
            <p className="sold-out">✦ Every ticket includes the KGC app for the whole week ✦</p>
          </div>
          <Image
            src="/kgc/tickets-hero.jpeg"
            alt="Attendees at the Knowledge Graph Conference"
            width={1024}
            height={768}
            priority
          />
        </div>
      </section>

      {/* The two headline tickets. */}
      <section className="band band-centred">
        <div className="wrap">
          <h2>Main Ticket Types</h2>

          {params.cancelled && (
            <p className="notice warn" style={{ marginTop: 20 }}>
              Checkout was cancelled and nothing was charged. Your details are below if you want to
              try again.
            </p>
          )}

          <div className="kgc-tickets">
            {headlineA && <TicketPanel tier={headlineA} tone="dark" />}
            {headlineB && <TicketPanel tier={headlineB} tone="light" />}
          </div>

          {/*
            Prose about two specific tiers, so it is shown only while those two
            tiers are the ones on screen.

            The slugs appear here as a *guard*, not as the selection — the
            panels above are chosen by `featured`. Before that change the notes
            could not disagree with the panels, because the panels were these
            two by definition. Now they can, and a paragraph explaining what
            "All Access (VIP)" includes above a band that is not showing it is
            the stale-copy failure this repo keeps finding.
          */}
          {(headlineA?.id === 'all-access' || headlineB?.id === 'all-access' ||
            headlineA?.id === 'main-conference' || headlineB?.id === 'main-conference') && (
            <div className="ticket-notes">
              {(headlineA?.id === 'all-access' || headlineB?.id === 'all-access') && (
                <p>
                  ✶ <strong>All Access (VIP)</strong> — entry to <em>all</em> in-person sessions,
                  including the limited-availability workshops, plus virtual streaming and
                  recordings.
                </p>
              )}
              {(headlineA?.id === 'main-conference' || headlineB?.id === 'main-conference') && (
                <p>
                  ✶ <strong>Main Conference</strong> — covers every main conference session, but{' '}
                  <strong>does not include the workshops</strong> (space is limited).
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/*
        The lighter tickets, on the live site's dark band.

        ── Why this heading does not say "Two" ─────────────────────────────────

        It used to, and it was wrong the moment an organizer added a fifth
        ticket type in the dashboard: three cards appeared under a heading that
        counted two. This section is `tiers` minus the two slugs handled above,
        so its length is whatever the catalogue holds — the copy must not
        restate a number the data owns.

        The section is skipped entirely when nothing falls into it. Hiding
        Workshops and Virtual in the dashboard is a supported thing to do, and
        it used to leave a band with a heading, a lede and no tickets under it.
      */}
      {smaller.length > 0 && (
      <section className="band band-navy band-centred">
        <div className="wrap">
          <h2>Smaller tickets, big impact.</h2>
          <p className="lede">Ideal if you would like to start with a lighter commitment.</p>

          <div className="kgc-tickets small">
            {smaller.map((t) => (
              <div key={t.id} className="kgc-ticket light">
                <h3>{t.name}</h3>
                <p className="price">{formatPrice(t.priceCents, t.currency)}</p>
                <ul>
                  {t.includes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {t.onSale ? (
                  <Link href={`/tickets?tier=${t.id}#buy`} className="btn btn-primary">
                    Choose {t.name}
                  </Link>
                ) : (
                  <p className="sold-out">{t.unavailableReason ?? 'Not available'}</p>
                )}
              </div>
            ))}
          </div>

          <p className="ticket-notes">
            All sessions are available on demand for at least one month after the conference.
          </p>
        </div>
      </section>
      )}

      {/* Where it happens — the live page's location band. */}
      <section className="band band-wave-light band-centred">
        <div className="wrap">
          <h2>It’s happening at {SITE.venueShort}.</h2>
          <p className="lede">We’d love to see you here in May.</p>
        </div>
      </section>

      {/*
        The route from paying to standing in the room, as a strip rather than an
        essay.

        This content used to be four numbered paragraphs stacked beside the
        checkout form, which put several hundred words of explanation in direct
        competition with the one control on the page that takes money. It is a
        genuine sequence — each step is only true once the one before it has
        happened — so it keeps its numbers, but it earns them in one line each
        and it sits above the form rather than next to it.
      */}
      <section className="band band-wash flow-band">
        <div className="wrap">
          <p className="eyebrow">How it works</p>
          <h2 className="flow-title">From paying to standing in the room</h2>
          <ol className="flow-strip">
            <li>
              <strong>Register</strong>
              Pick a ticket, and give us the attendee’s name and email address.
            </li>
            <li>
              <strong>Keep the claim code</strong>
              Six characters, shown the moment you pay. It is the fallback door into your ticket.
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
              questions={form.fields}
            />
          ) : (
            <div className="checkout checkout-closed">
              <h2 style={{ fontSize: '1.4rem' }}>Registration is not open yet</h2>
              <p className="notice warn">
                Ticket sales for {SITE.name} have not opened. Everything else on this page — the
                dates, the venue, what each ticket includes — is current.
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
        The questions, below the purchase rather than beside it.

        Every one of these was a bold-lead paragraph in a column running down the
        side of the checkout form, where a buyer had to read past all five to
        reach the thing they came for. As collapsed rows they take a tenth of the
        height, they are scannable by question, and the one a particular person
        needs is one click away instead of four paragraphs down.
      */}
      <section className="band-wash">
        <div className="kgc-faq">
          <h2>Questions people actually ask</h2>

          <details>
            <summary>Can I transfer my ticket to someone else?</summary>
            <div className="answer">
              <p>
                Yes, up to a week before the conference. Mail{' '}
                <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> with the new
                attendee’s details and we will move the registration rather than issue a second
                one.
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
              <p>
                Yes — every session, on demand, for at least a month after the conference closes.
              </p>
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
                Yes — <Link href="/tickets/invoice">request one here</Link>. We’ll email a payable
                invoice with a PO number on it, on net-14 to net-60 terms. Useful for groups, and
                for anywhere procurement has to sign off.
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
