import Link from 'next/link';
import { APP_DISTRIBUTION, EVENT, publicSiteOrigin } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { GapPanel, PageHeader, Panel } from '../../../ui';
import { QrDownload, QrSymbol, eventWindow } from '../snippet';

export const dynamic = 'force-dynamic';

/**
 * Tools › App Adoption › Downloadable Graphics.
 *
 * ── The one graphic that does not need an image pipeline ────────────────────
 *
 * Whova generates a branded pack — social cards, an email banner, slide
 * backgrounds — and every one of those needs a server-side image renderer,
 * which this project does not have.
 *
 * The **printable table sign** does not. A QR is a vector, the sign is HTML,
 * and the browser is already the print pipeline everywhere else in this
 * dashboard (see `attendees/name-badges`). So the sign is built for real here
 * and prints from ⌘P, and the rest of Whova's pack is absent rather than
 * described.
 *
 * The dates are counted off the programme rather than typed — `eventWindow()`
 * explains why a hand-maintained date in a printed artefact is the one place a
 * stale date does real damage.
 */
export default async function DownloadableGraphicsPage() {
  await requireOrganizer();
  const origin = publicSiteOrigin();
  const href = `${origin}/tickets`;
  const dates = await eventWindow();

  return (
    <>
      <PageHeader
        title="Downloadable Graphics"
        info={
          <>
            <strong>One printable sign</strong>
            <p>
              The desk sign prints from your browser. Social cards, banners and slide backgrounds
              are not available yet.
            </p>
          </>
        }
        actions={
          <Link className="whova-btn-main secondary" href="/tools/app-adoption/app-download-button">
            Buttons and links
          </Link>
        }
        links={[
          <Link key="s" href="/tools/app-adoption/social-media">
            Social posts
          </Link>,
          <Link key="b" href="/tools/app-adoption/app-download-button">
            Download button
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Registration desk sign</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Print this page from a computer at A5, 100% scale, with backgrounds off. It also
          photocopies well in black and white.
        </p>

        {/* The sign is 559px wide; under 768px it is scaled to fit the panel. */}
        <style>{'@media screen and (max-width: 767px) { .desk-sign { zoom: 0.55; } }'}</style>

        {/*
          Fixed millimetre dimensions rather than a responsive card: this is a
          physical artefact and the only size that matters is the one that comes
          out of the printer. 148×210mm is A5 portrait.
        */}
        <div
          className="desk-sign"
          style={{
            background: '#fff',
            border: '1px solid var(--hairline)',
            boxSizing: 'border-box',
            color: '#000',
            height: '210mm',
            margin: '0 auto',
            padding: '16mm 12mm',
            textAlign: 'center',
            width: '148mm',
          }}
        >
          {/*
            The full-colour lockup, not the white wordmark the dashboard header
            wears: this sheet is ink on white paper, and white artwork on it is
            a blank space. It is also an `<img>` rather than a CSS background,
            because the instruction above is to print with backgrounds off and a
            background-image is exactly what that switch drops. 46mm wide off a
            400px asset is a little over 220 dpi.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/kgc/logo-colour.png"
            alt={EVENT.name}
            style={{ display: 'block', height: 'auto', margin: '0 auto', width: '46mm' }}
          />
          <div style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15, marginTop: '6mm' }}>
            Get the conference app
          </div>
          <div style={{ fontSize: 15, marginTop: '3mm' }}>
            Your badge, the agenda, and everyone else who is here
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', margin: '10mm 0' }}>
            <QrSymbol text={href} px={300} label={href} />
          </div>

          <div style={{ fontSize: 16, fontWeight: 600, wordBreak: 'break-all' }}>{href}</div>
          <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: '6mm' }}>{APP_DISTRIBUTION}</div>
          <div style={{ fontSize: 12, marginTop: '8mm' }}>
            {EVENT.name}
            {dates ? ` · ${dates}` : ''}
          </div>
          <div style={{ fontSize: 12 }}>{EVENT.venue}</div>
        </div>

        {dates === null && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
            The dates appear on the sign once the agenda has sessions.
          </p>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The QR code on its own</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          A vector file for a slide, a lanyard card or another design. Keep the white border when
          you place it.
        </p>
        <QrDownload text={href} />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Social cards, email banners, slide backgrounds.</strong> A server-side image
            renderer — Satori or headless Chrome. Storage now exists, so the missing half is the
            renderer rather than somewhere to put the output.
          </li>
          <li>
            <strong>A mark other than KGC&rsquo;s.</strong> The sign carries the KGC lockup, which
            is committed to this app. There is no per-event branding setting behind it, so a
            co-branded or sponsored sign means editing this file — unlike the certificate, which
            takes an uploaded mark.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
