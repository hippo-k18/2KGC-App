import Link from 'next/link';
import { APP_DISTRIBUTION, EVENT, publicSiteOrigin } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { GapPanel, PageHeader, Panel } from '../../../ui';
import { QrSymbol, eventWindow, qrSvgMarkup } from '../snippet';

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
            <strong>One sign, no image pipeline</strong>
            <p>
              The table sign below is real and prints from your browser. Social cards, banners and
              slide backgrounds need a server-side image renderer, which this project does not
              have.
            </p>
          </>
        }
        actions={
          <Link className="whova-btn-main secondary" href="/tools/app-adoption/app-download-button">
            Snippets and QR markup
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
          A5 at 100% on the browser&rsquo;s print dialogue, or scale it up for a lectern. Print with
          backgrounds off. The KGC mark is the only colour on it and everything else is black on
          white on purpose, because a table sign gets photocopied, and the mark is dark enough to
          survive that in greyscale.
        </p>

        {/*
          Fixed millimetre dimensions rather than a responsive card: this is a
          physical artefact and the only size that matters is the one that comes
          out of the printer. 148×210mm is A5 portrait.
        */}
        <div
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
            The dates are left off because no session has a day yet. They are counted from the
            programme rather than typed, so that a printed sign cannot carry a date the agenda has
            since moved.
          </p>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The symbol on its own</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          For a slide, a lanyard card, or somebody else&rsquo;s design. Vector, so it prints at any
          size; the four-module quiet zone is already inside the box and must not be cropped off.
        </p>
        <pre className="whova-code" style={{ userSelect: 'all' }}>
          {qrSvgMarkup(href, 600)}
        </pre>
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
