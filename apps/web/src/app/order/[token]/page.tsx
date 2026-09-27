import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readOrderToken } from '@/lib/order-token';
import { getRegistration } from '@/lib/registrations';
import { ScrollToTop } from '@/components/scroll-to-top';
import { QrCode } from '@/components/qr-code';
import { PassTilt } from '@/components/pass-tilt';
import { siteEvent } from '@/lib/data';
import { APP_URL, SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Your ticket',
  // This page shows who holds a ticket. It must never be indexed, and
  // `noarchive` also keeps it out of search-engine caches.
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

/** Per-request, and it has to be. Reads a capability token and the live state of the ticket behind it. A refunded or cancelled order has to stop showing as a ticket on the next load, not a minute later, and two visitors never hold the same token. */
export const dynamic = 'force-dynamic';

/** `https://app.example.org` → `app.example.org`. */
const appHost = APP_URL?.replace(/^https?:\/\//, '') ?? '';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `2027-05-03` + `2027-05-07` → `{ days: '3–7', rest: 'May 2027' }`, for the
 * large date on the stub. Null when the span crosses a month or either date is
 * not a plain ISO day, and the stub prints `datesShort` instead.
 */
function stubDates(start: string, end: string): { days: string; rest: string } | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(end || start);
  if (!a || !b || a[1] !== b[1] || a[2] !== b[2]) return null;
  const month = MONTHS[Number(a[2]) - 1];
  if (!month) return null;
  const from = Number(a[3]);
  const to = Number(b[3]);
  return { days: from === to ? `${from}` : `${from}–${to}`, rest: `${month} ${a[1]}` };
}

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
 * The order renders as a conference pass: a main panel carrying who and where,
 * and a perforated stub carrying the part you present. The tear line is not
 * decoration. It marks the real division on this page between the part that is
 * a record and the part you hand over.
 *
 * ── What is *not* on this page ──────────────────────────────────────────────
 *
 * No claim code and no temporary password (owner, 2026-09-26). The desk finds
 * people by email, and session pages sign in with an emailed code, so neither
 * earned its place on a page that gets forwarded and screenshotted.
 *
 * No `qrSecret` either. When the stub shows a QR it encodes `APP_URL` and
 * nothing else. The badge QR stays in Firestore for the app to fetch once the
 * attendee has actually authenticated. See `src/lib/qr.ts`.
 */
export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const ev = await siteEvent();
  const { token } = await params;
  const payload = readOrderToken(decodeURIComponent(token));
  if (!payload) notFound();

  const reg = await getRegistration(payload.rid);
  if (!reg) notFound();

  /*
   * `name` and `ticketType` are both optional on `RegistrationDoc`, and not
   * merely in theory: a registration imported from a Whova CSV can arrive with
   * no name at all. The address stands in for the name, and "Registered" for a
   * tier nobody recorded.
   *
   * `trim()` on top of that because the name comes from a text input, and "  "
   * is a value a buyer can submit.
   */
  const attendeeName = reg.name?.trim() ?? '';
  const firstName = attendeeName.split(/\s+/)[0] ?? '';
  const tier = reg.ticketType ?? 'Registered';

  const when = stubDates(ev.startDate, ev.endDate);
  // "Jay Conference Bryant Park, New York" → the place, with the city on a line under it.
  const [venuePlace, ...venueRest] = ev.venueShort.split(',');
  const venueCity = venueRest.join(',').trim();

  return (
    <section className="order-page">
      {/*
        The buyer arrives here from a `redirect()` in the checkout server
        action, which is a soft navigation. Without this they land at whatever
        scroll offset the tickets page was at. See `components/scroll-to-top.tsx`.
      */}
      <ScrollToTop />
      <div className="wrap narrow order-wrap">
        <p className="eyebrow">Confirmed</p>
        <h1 className="order-headline">
          {firstName ? `You’re in, ${firstName}.` : 'You’re registered for KGC 2027.'}
        </h1>

        <p className="notice">
          Check your email for a receipt.
        </p>

        <PassTilt>
          <div className="pass">
            <div className="pass-main">
              {/* Decoration only: the event name is the kicker right below it. */}
              <img className="pass-watermark" src="/kgc/cropped-White-Wordmark-2.png" alt="" />
              <p className="pass-kicker">{ev.name}</p>
              <p className="pass-name">{attendeeName || reg.email}</p>
              <p className="pass-tier">{tier}</p>

              <dl className="pass-facts">
                <div>
                  <dt>Dates</dt>
                  <dd>{ev.datesLong}</dd>
                </div>
                <div>
                  <dt>Venue</dt>
                  <dd>
                    {venuePlace}
                    {venueCity ? <span className="pass-small">{venueCity}</span> : null}
                  </dd>
                </div>
              </dl>

              <dl className="pass-issued">
                <dt>Issued to</dt>
                <dd>{reg.email}</dd>
              </dl>
            </div>

            {/*
              The stub is what a real one is: the part that survives being torn
              off, so it repeats the few things that matter at the door on its
              own. The event, "admit one" and the tier, the dates set large, and
              the registration number running up the edge like a serial.
            */}
            <div className="pass-stub">
              <p className="pass-stub-head">
                <img
                  className="pass-stub-mark"
                  src="/kgc/cropped-White-Wordmark-2.png"
                  alt={ev.shortName || 'KGC'}
                />
                <span className="pass-stub-year">{ev.year}</span>
              </p>

              <p className="pass-admit">Admit one</p>
              <p className="pass-stub-tier">{tier}</p>

              <p className="pass-stub-date">
                {when ? (
                  <>
                    <span className="pass-stub-days">{when.days}</span>
                    <span className="pass-stub-month">{when.rest}</span>
                  </>
                ) : (
                  <span className="pass-stub-month">{ev.datesShort}</span>
                )}
              </p>

              {APP_URL ? (
                <>
                  <div className="pass-qr-tile">
                    <QrCode
                      value={APP_URL}
                      size={120}
                      title={`Scan to open the KGC app at ${appHost}`}
                      className="pass-qr"
                    />
                  </div>
                  {/*
                    The destination in text as well as in the symbol. A screen
                    reader user cannot point a camera at a QR code.
                  */}
                  <p className="pass-stub-label">
                    Get the app
                    <a href={APP_URL} target="_blank" rel="noreferrer">
                      {appHost}
                    </a>
                  </p>
                </>
              ) : null}

              <p className="pass-serial">
                <span className="sr-only">Registration </span>
                {reg.registrationId}
              </p>
            </div>

            {/* The foil: a colour sheen, glitter and a glare, all driven by the
                pointer through `PassTilt`. Purely visual. */}
            <span className="pass-foil" aria-hidden="true" />
            <span className="pass-glitter" aria-hidden="true" />
            <span className="pass-glare" aria-hidden="true" />
          </div>
        </PassTilt>

        <p className="muted order-fine">
          Questions about your ticket:{' '}
          <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
        </p>
      </div>
    </section>
  );
}
