import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readOrderToken } from '@/lib/order-token';
import { getRegistration } from '@/lib/registrations';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Your ticket',
  // This page contains a sign-in credential. It must never be indexed, and
  // `noarchive` also keeps it out of search-engine caches.
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export const dynamic = 'force-dynamic';

/**
 * The order confirmation — the screen the whole site exists to reach.
 *
 * It is reached through an HMAC-signed capability token rather than the
 * registration id, because the registration id is `sha256(email)` and would
 * therefore be computable by anyone who knew the attendee's address. See
 * `src/lib/order-token.ts`.
 *
 * Note what is *not* on this page: `qrSecret`. The confirmation shows the
 * claim code, which is a deliberately low-stakes fallback credential, and
 * leaves the QR secret in Firestore for the app to fetch after the attendee
 * has actually authenticated. Printing it here would put a badge credential in
 * a URL that might be forwarded, screenshotted or left open on a shared laptop.
 */
export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = readOrderToken(decodeURIComponent(token));
  if (!payload) notFound();

  const reg = await getRegistration(payload.rid);
  if (!reg) notFound();

  return (
    <section>
      <div className="wrap narrow">
        <p className="eyebrow">Confirmed</p>
        <h1 style={{ fontSize: 'clamp(1.9rem, 4vw, 2.6rem)' }}>
          You’re registered for KGC 2027
        </h1>

        {payload.demo ? (
          <p className="notice warn">
            <strong>No payment was taken.</strong> This deployment has no payment processor
            configured, so this was a test purchase. Your registration is real and the mobile app
            will accept it — but no money changed hands and there is no receipt.
          </p>
        ) : (
          <p className="notice">
            Stripe has emailed your receipt to <strong>{reg.email}</strong>. This page is your
            ticket.
          </p>
        )}

        <div className="ticket" style={{ marginTop: 26 }}>
          <div className="top">
            <h2>{reg.ticketType}</h2>
            <div className="sub">
              {SITE.datesLong} · {SITE.venue}
            </div>
          </div>
          <div className="rows">
            <div className="row">
              <span className="k">Attendee</span>
              <span className="v">{reg.name}</span>
            </div>
            <div className="row">
              <span className="k">Email</span>
              <span className="v">{reg.email}</span>
            </div>
            <div className="row">
              <span className="k">Ticket</span>
              <span className="v">{reg.ticketType}</span>
            </div>
            <div className="row">
              <span className="k">Registration</span>
              <span className="v mono">{reg.registrationId}</span>
            </div>
          </div>
        </div>

        <div className="claim">
          <p className="eyebrow" style={{ margin: 0 }}>
            Your claim code
          </p>
          <p className="code">{reg.claimCode}</p>
          <p className="muted" style={{ margin: '12px 0 0', fontSize: '0.9rem' }}>
            Write this down. It is also printed on your badge.
          </p>
        </div>

        <h2 style={{ fontSize: '1.5rem' }}>Next: get the app</h2>
        <p>
          Your ticket, your schedule, the attendee directory and your check-in QR all live in the KGC
          app. There is nothing to activate — the registration is already waiting for you.
        </p>

        <ol className="steps" style={{ margin: '24px 0 32px' }}>
          <li>
            <strong>Download the KGC app</strong>
            Search “Knowledge Graph Conference” on the App Store or Google Play.
          </li>
          <li>
            <strong>Sign in with {reg.email}</strong>
            The same address you registered with. That is what matches you to this ticket — use a
            different one and the app will not find it.
          </li>
          <li>
            <strong>If the address is wrong, use the claim code</strong>
            Enter <span className="mono">{reg.claimCode}</span> when the app asks, and it will attach
            this registration to whichever account you signed in with.
          </li>
          <li>
            <strong>Build your schedule</strong>
            Star sessions from the <Link href="/agenda">agenda</Link> and they sync to your phone.
          </li>
        </ol>

        <p className="muted" style={{ fontSize: '0.9rem' }}>
          Buying again with the same email address updates this registration rather than creating a
          second one, so you cannot accidentally end up with two tickets. Need to add a colleague?
          Register them with their own address. Anything else:{' '}
          <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
        </p>

        <p style={{ marginTop: 28 }}>
          <Link href="/agenda" className="btn btn-outline">
            Plan your week
          </Link>
        </p>
      </div>
    </section>
  );
}
