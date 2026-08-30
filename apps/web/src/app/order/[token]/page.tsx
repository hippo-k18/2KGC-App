import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readOrderToken } from '@/lib/order-token';
import { getRegistration } from '@/lib/registrations';
import { demoMode } from '@/lib/demo';
import { ScrollToTop } from '@/components/scroll-to-top';
import { QrCode } from '@/components/qr-code';
import { APP_DISTRIBUTION, APP_URL, SITE } from '@/lib/site';
import { DEMO_APP_PASSWORD } from '@/lib/demo-credentials';

export const metadata: Metadata = {
  title: 'Your ticket',
  // This page contains a sign-in credential. It must never be indexed, and
  // `noarchive` also keeps it out of search-engine caches.
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export const dynamic = 'force-dynamic';

/** `https://kgc-2027-app.netlify.app` → `kgc-2027-app.netlify.app`. */
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
  const { token } = await params;
  const payload = readOrderToken(decodeURIComponent(token));
  if (!payload) notFound();

  const reg = await getRegistration(payload.rid);
  if (!reg) notFound();

  const demo = demoMode();
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

        {payload.demo && demo ? (
          <p className="notice warn">
            <strong>Payment approved — demo.</strong> The order is recorded as paid and appears on
            the organizer dashboard exactly as a real sale would, but no card was charged and no
            receipt was emailed. The ticket below is real: the app will accept this claim code.
          </p>
        ) : payload.demo ? (
          <p className="notice warn">
            <strong>No payment was taken.</strong> This deployment has no payment processor
            configured, so this was a test purchase. Your registration is real and the mobile app
            will accept it — but no money changed hands and there is no receipt.
          </p>
        ) : (
          <p className="notice">
            Stripe has emailed your receipt to <strong>{reg.email}</strong>. This page is your
            ticket — bookmark it, or screenshot the pass below.
          </p>
        )}

        {/*
          The pass. Two panels and a tear line: the record on the left, the two
          things worth keeping on the right.
        */}
        <div className="pass">
          <div className="pass-main">
            <p className="pass-kicker">{SITE.name}</p>
            <p className="pass-name">{attendeeName || reg.email}</p>
            <p className="pass-tier">{reg.ticketType ?? 'Registered'}</p>

            <dl className="pass-facts">
              <div>
                <dt>Dates</dt>
                <dd>{SITE.datesLong}</dd>
              </div>
              <div>
                <dt>Venue</dt>
                <dd>{SITE.venueShort}</dd>
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
          </div>
        </div>

        <p className="pass-note">
          Keep the claim code. It also appears in the app under <strong>Me → Badge</strong> once
          you have signed in — but if you cannot sign in, this page is the only place you will find
          it. Give it to the registration desk and they will attach this ticket to whichever
          account you signed in with.
        </p>

        <h2 className="order-next-title">Three things, then you’re done</h2>

        <ol className="next-cards">
          {/*
            In demo mode the account already exists — the purchase created it —
            so the first card can print the password rather than promise a link.
            Outside demo mode no account was created, and telling somebody to
            sign in would be a lie.
          */}
          <li>
            <h3>Sign in to the app</h3>
            {demo ? (
              <>
                <p>
                  Your account was created by this purchase. Nothing to install — it runs in a
                  browser.
                </p>
                {/*
                  The password is monospaced and the address is not. Mono earns
                  its place on a string somebody has to transcribe character by
                  character — it is what tells an l from a 1 — and costs about
                  15% width, which is the difference between this address
                  sitting on one line and breaking as "example.c / om".
                */}
                <dl className="next-creds">
                  <dt>Email</dt>
                  <dd>{reg.email}</dd>
                  <dt>Password</dt>
                  <dd className="mono">{DEMO_APP_PASSWORD}</dd>
                </dl>
                <a href={APP_URL} target="_blank" rel="noreferrer" className="btn btn-primary">
                  Open the KGC app
                </a>
              </>
            ) : (
              <>
                <p>
                  Sign in with <strong>{reg.email}</strong> — the same address you registered with.
                  That is what matches you to this ticket; a different one will not find it.
                </p>
                <p className="muted">{APP_DISTRIBUTION}</p>
              </>
            )}
          </li>

          <li>
            <h3>Build your schedule</h3>
            <p>
              Star the sessions you want from the agenda and they sync to your phone. Workshops
              fill up, so the useful time to do this is now rather than in May.
            </p>
            <Link href="/agenda" className="btn btn-outline">
              Plan your week
            </Link>
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
