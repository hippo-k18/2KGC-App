import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readOrderToken } from '@/lib/order-token';
import { getRegistration } from '@/lib/registrations';
import { pendingTemporaryPasswordFor } from '@/lib/app-account';
import { ScrollToTop } from '@/components/scroll-to-top';
import { QrCode } from '@/components/qr-code';
import { siteEvent, siteVisibility } from '@/lib/data';
import { forgetTicketAction, useTicketOnThisDeviceAction } from '@/app/ticket-actions';
import { readTicketPass } from '@/lib/ticket-pass';
import { APP_DISTRIBUTION, APP_URL, SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Your ticket',
  // This page contains a sign-in credential. It must never be indexed, and
  // `noarchive` also keeps it out of search-engine caches.
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

/** Per-request, and it has to be. Reads a capability token and the live state of the ticket behind it. A refunded or cancelled order has to stop showing a claim code on the next load, not a minute later, and two visitors never hold the same token. */
export const dynamic = 'force-dynamic';

/** `https://kgc27-app.netlify.app` → `kgc27-app.netlify.app`. */
const appHost = APP_URL.replace(/^https?:\/\//, '');

/**
 * The order confirmation — the screen the whole site exists to reach.
 *
 * It is reached through an HMAC-signed capability token rather than the
 * registration id, because the registration id is `sha256(email)` and would
 * therefore be computable by anyone who knew the attendee's address. See
 * `src/lib/order-token.ts`.
 *
 * ── The pass, and why the page is shaped like one ───────────────────────────
 *
 * This used to be a column of full-width blocks — a notice, a table of four
 * key/value rows, a dashed box holding the claim code, a heading, a paragraph,
 * a numbered list and two more paragraphs — every one of them the same width
 * and roughly the same weight, so nothing on the page told you what to do with
 * it. What a buyer actually wants from this screen is a thing they can keep.
 *
 * So the order renders as a conference pass: a main panel carrying who and
 * where, and a perforated stub carrying the two credentials worth keeping — a
 * QR that opens the app, and the claim code. The tear line is not decoration.
 * It marks the real division on this page between the part that is a record and
 * the part you present.
 *
 * ── What is *not* on this page: `qrSecret` ──────────────────────────────────
 *
 * The symbol in the stub encodes `APP_URL` and nothing else — a public link,
 * safe on a page that might be forwarded, screenshotted, or left open on a
 * shared laptop. The attendee's badge QR encodes `qrSecret`, which stays in
 * Firestore for the app to fetch once they have actually authenticated. Adding
 * it here would put a badge credential in a URL. See `src/lib/qr.ts`.
 *
 * The claim code is printed because it is a deliberately low-stakes fallback:
 * it proves which registration you are talking about at a staffed desk, and it
 * does not open a door on its own.
 */
export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const [ev, show] = await Promise.all([siteEvent(), siteVisibility()]);
  const { token } = await params;
  const rawToken = decodeURIComponent(token);
  const payload = readOrderToken(rawToken);
  if (!payload) notFound();

  const reg = await getRegistration(payload.rid);
  if (!reg) notFound();

  /*
   * Whether this browser is already carrying *this* ticket. Compared by
   * registration id rather than by the presence of a cookie, so somebody
   * opening a colleague's forwarded link is offered the swap rather than being
   * told they already have it.
   */
  const pass = await readTicketPass();
  const passHeld = pass?.registrationId === payload.rid;

  // Null unless a password was stored for this registration AND the account
  // still carries `mustChangePassword` — so the block disappears, and the
  // stored credential is swept, once they have changed it.
  const tempPassword = await pendingTemporaryPasswordFor(reg.email);

  /*
   * `name`, `ticketType` and `claimCode` are all optional on `RegistrationDoc`,
   * and not merely in theory — a registration imported from a Whova CSV can
   * arrive with no name at all. Each therefore has a fallback that is still a
   * true statement rather than an empty slot: the address stands in for the
   * name, "Registered" for a tier nobody recorded, and the claim block is
   * simply absent when there is no code to print.
   *
   * `trim()` on top of that because the name comes from a text input, and "  "
   * is a value a buyer can submit — "You're in, ." is worse than the generic
   * headline it would replace.
   */
  const attendeeName = reg.name?.trim() ?? '';
  const firstName = attendeeName.split(/\s+/)[0] ?? '';

  return (
    <section className="order-page">
      {/*
        The buyer arrives here from a `redirect()` in the checkout server
        action, which is a soft navigation — without this they land at whatever
        scroll offset the tickets page was at, which is the bottom, because that
        is where the pay button is. See `components/scroll-to-top.tsx`.
      */}
      <ScrollToTop />
      {/*
        One column for the whole page.

        It was two — `.wrap.narrow` for the pass and the prose, a wider wrap for
        the three cards — and the two measures put the cards' left edge 160px
        outside the pass's, which read as a layout fault rather than as emphasis.
        980 is wide enough for three cards that do not break their own headings,
        and the site's existing `.wrap.narrow p` rule still holds the running
        prose inside it to 68 characters. See `globals.css`.
      */}
      <div className="wrap narrow order-wrap">
        <p className="eyebrow">Confirmed</p>
        <h1 className="order-headline">
          {firstName ? `You’re in, ${firstName}.` : 'You’re registered for KGC 2027.'}
        </h1>

        <p className="notice">
          Stripe has emailed your receipt to <strong>{reg.email}</strong>. This page is your
          ticket. Bookmark it, or screenshot the pass below.
        </p>

        {/*
          The pass. Two panels and a tear line: the record on the left, the two
          things worth keeping on the right.
        */}
        <div className="pass">
          <div className="pass-main">
            <p className="pass-kicker">{ev.name}</p>
            <p className="pass-name">{attendeeName || reg.email}</p>
            <p className="pass-tier">{reg.ticketType ?? 'Registered'}</p>

            <dl className="pass-facts">
              <div>
                <dt>Dates</dt>
                <dd>{ev.datesLong}</dd>
              </div>
              <div>
                <dt>Venue</dt>
                <dd>{ev.venueShort}</dd>
              </div>
              {/*
                Both of these run the full width of the panel. An address and a
                `reg_` id are each about 25 characters, which is a hair more than
                half of this panel holds — so in a two-column grid they broke
                mid-word ("demo.attendee@exa / mple.com"), which reads as a
                rendering fault rather than as a wrap.
              */}
              <div className="pass-fact-wide">
                <dt>Email</dt>
                <dd>{reg.email}</dd>
              </div>
              <div className="pass-fact-wide">
                <dt>Registration</dt>
                <dd className="mono">{reg.registrationId}</dd>
              </div>
            </dl>
          </div>

          <div className="pass-stub">
            <QrCode
              value={APP_URL}
              size={150}
              title={`Scan to open the KGC app at ${appHost}`}
              className="pass-qr"
            />
            {/*
              The destination in text as well as in the symbol. A screen reader
              user cannot point a camera at a QR code, and neither can anybody
              reading this page on the phone the app would open on.
            */}
            <p className="pass-stub-label">
              Get the app
              <a href={APP_URL} target="_blank" rel="noreferrer">
                {appHost}
              </a>
            </p>

            {reg.claimCode ? (
              <div className="pass-claim">
                <p className="pass-claim-label">Claim code</p>
                <p className="pass-claim-code">{reg.claimCode}</p>
              </div>
            ) : null}

            {tempPassword ? (
              <div className="pass-claim">
                <p className="pass-claim-label">Temporary password</p>
                <p className="pass-claim-code">{tempPassword}</p>
              </div>
            ) : null}
          </div>
        </div>

        <p className="pass-note">
          Keep the claim code. It also appears in the app under <strong>Me → Badge</strong> once
          you have signed in. If you cannot sign in, give it to the registration desk and they will
          attach this ticket to your account.
        </p>

        {/*
          The one thing this page can do that the app cannot: put the ticket on
          the browser in front of you, so a session page on this site knows
          which ticket you hold and can play a stream you paid for.

          It is a button rather than something this page does on arrival for two
          reasons. A cookie cannot be written from a Server Component at all —
          only from an action — and, more to the point, a forwarded
          confirmation link opened by an assistant should not silently leave
          somebody else's ticket on their machine. See `lib/ticket-pass.ts`.
        */}
        <section className="watch-device">
          <h2>Watch on this device</h2>
          {passHeld ? (
            <>
              <p>
                This browser is using this ticket. Sessions with a live stream or a recording play
                on their own page, where your ticket covers them.
              </p>
              <p className="watch-actions">
                {show.agenda && (
                  <Link className="btn btn-primary" href="/agenda">
                    Go to the agenda
                  </Link>
                )}
                <form action={forgetTicketAction}>
                  <button type="submit" className="btn btn-outline">
                    Forget this ticket
                  </button>
                </form>
              </p>
            </>
          ) : (
            <>
              <p>
                Some sessions are streamed live and recorded. Put this ticket on this browser and
                they play on the session page. Nothing is shared with anyone; it is one cookie on
                this device, and you can remove it from any session page.
              </p>
              <form action={useTicketOnThisDeviceAction} className="watch-actions">
                <input type="hidden" name="token" value={rawToken} />
                <button type="submit" className="btn btn-primary">
                  Use this ticket on this device
                </button>
              </form>
            </>
          )}
        </section>

        <h2 className="order-next-title">Three things, then you’re done</h2>

        <ol className="next-cards">
          {/*
            The webhook that marked this order paid also created the Auth
            account, stamped the `registered` claim and wrote the profile — see
            `lib/app-account-core.ts`. So "sign in" is a statement about
            something that exists, which is what it was not while the account
            was created only by the demo path.

            ⚠️ It now also prints a credential, which this comment used to say
            it must never do. `tempPassword` is non-null only while the account
            still carries `mustChangePassword` — so the moment the attendee has
            changed it, this page stops showing one and falls back to describing
            the code. A page that kept printing a password somebody had already
            replaced would be worse than useless: it would be wrong, and it
            would look authoritative while being wrong.
          */}
          <li>
            <h3>Sign in to the app</h3>
            {tempPassword ? (
              <p>
                Your account was created by this purchase. Open the app and sign in with{' '}
                <strong>{reg.email}</strong> and the temporary password above, which is also in
                your receipt. <strong>The app will ask you to change it straight away.</strong> You
                can also sign in with a six-digit code, which the app emails to this address.
              </p>
            ) : (
              <p>
                Your account was created by this purchase. Open the app, enter{' '}
                <strong>{reg.email}</strong>, and it emails you a six-digit code. Use that address;
                another one will not find this ticket.
              </p>
            )}
            <p className="muted">{APP_DISTRIBUTION}</p>
            <a href={APP_URL} target="_blank" rel="noreferrer" className="btn btn-primary">
              Open the KGC app
            </a>
          </li>

          <li>
            <h3>Build your schedule</h3>
            <p>
              Star the sessions you want from the agenda and they sync to your phone. Workshops
              fill up.
            </p>
            {show.agenda && (
              <Link href="/agenda" className="btn btn-outline">
                Plan your week
              </Link>
            )}
          </li>

          <li>
            <h3>Scan in at the door</h3>
            <p>
              Your badge QR lives in the app under <strong>Me → Badge</strong>. It carries a random
              secret rather than your identity, so somebody photographing it over your shoulder
              learns nothing about who you are.
            </p>
          </li>
        </ol>

        <p className="muted order-fine">
          Buying again with the same email address updates this registration rather than creating a
          second one, so you cannot accidentally end up with two tickets. Need to add a colleague?
          Register them with their own address. Anything else:{' '}
          <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
        </p>
      </div>
    </section>
  );
}
