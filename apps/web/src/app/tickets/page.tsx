import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import { tiersOrNull } from '@/lib/catalogue';
import { formatPrice, type Tier, type TicketId } from '@/lib/tickets';
import { stripeEnabled } from '@/lib/stripe';
import { demoMode } from '@/lib/demo';
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
 */
function TicketPanel({ tier, tone }: { tier: Tier; tone: 'dark' | 'light' }) {
  const groups = tier.groups ?? [{ heading: 'Includes', items: [...tier.includes] }];

  return (
    <div className={`kgc-ticket ${tone}`}>
      <h3>{tier.name}</h3>
      <p className="price">{formatPrice(tier.priceCents)}</p>

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

      <Link
        href={`/tickets?tier=${tier.id}#buy`}
        className={`btn ${tone === 'dark' ? 'btn-accent' : 'btn-primary'}`}
      >
        Choose {tier.name}
      </Link>
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
   * The two headline panels are still addressed by slug, because the layout is
   * genuinely bespoke to them — a dark panel and a light one, side by side.
   * `?? tiers[n]` keeps the page rendering if a tier is renamed or hidden in
   * the dashboard, instead of throwing on a non-null assertion.
   */
  const allAccess = byId.get('all-access') ?? tiers[0];
  const mainConf = byId.get('main-conference') ?? tiers[1];
  const smaller = tiers.filter((t) => t.id !== allAccess?.id && t.id !== mainConf?.id);

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
            {allAccess && <TicketPanel tier={allAccess} tone="dark" />}
            {mainConf && <TicketPanel tier={mainConf} tone="light" />}
          </div>

          <div className="ticket-notes">
            <p>
              ✶ <strong>All Access (VIP)</strong> — entry to <em>all</em> in-person sessions,
              including the limited-availability workshops, plus virtual streaming and recordings.
            </p>
            <p>
              ✶ <strong>Main Conference</strong> — covers every main conference session, but{' '}
              <strong>does not include the workshops</strong> (space is limited).
            </p>
          </div>
        </div>
      </section>

      {/* The two lighter tickets, on the live site's dark band. */}
      <section className="band band-navy band-centred">
        <div className="wrap">
          <h2>Two smaller tickets, big impact.</h2>
          <p className="lede">Ideal if you would like to start with a lighter commitment.</p>

          <div className="kgc-tickets small">
            {smaller.map((t) => (
              <div key={t.id} className="kgc-ticket light">
                <h3>{t.name}</h3>
                <p className="price">{formatPrice(t.priceCents)}</p>
                <ul>
                  {t.includes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <Link href={`/tickets?tier=${t.id}#buy`} className="btn btn-primary">
                  Choose {t.name}
                </Link>
              </div>
            ))}
          </div>

          <p className="ticket-notes">
            All sessions are available on demand for at least one month after the conference.
          </p>
        </div>
      </section>

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
              demo={demoMode()}
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
