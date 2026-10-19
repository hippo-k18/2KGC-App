import Link from 'next/link';
import { APP_DISTRIBUTION, publicSiteOrigin } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { GapPanel, PageHeader, Panel } from '../../../ui';
import { QrDownload, QrSymbol, Snippet } from '../snippet';

export const dynamic = 'force-dynamic';

/**
 * Tools › App Adoption › App Download Button.
 *
 * ── Everything on this screen resolves to one URL ────────────────────────────
 *
 * `publicSiteOrigin()` plus `/tickets`. Whova gives you App Store and Google
 * Play badges; this app is on neither — it runs in Expo Go — so a store badge
 * would be a button that goes nowhere, pasted by an organizer onto a page a
 * thousand people read. That failure has already happened once on this project:
 * the order confirmation told buyers to search the App Store, and
 * `APP_DISTRIBUTION` in `@kgc/shared` carries a long comment about it.
 *
 * So the snippets point at the tickets page, which carries the real route in one
 * sentence the owner changes in one place, and the QR below encodes the same
 * URL. On the day the app is listed, `APP_DISTRIBUTION` changes and every
 * snippet here changes with it.
 */
export default async function AppDownloadButtonPage() {
  await requireOrganizer();
  const origin = publicSiteOrigin();
  const href = `${origin}/tickets`;

  const html = `<a href="${href}"
   style="display:inline-block;background:#263759;color:#fff;text-decoration:none;
          padding:12px 24px;border-radius:6px;font-family:sans-serif;font-weight:600;">
  Get the KGC 2027 app
</a>`;

  return (
    <>
      <PageHeader
        title="App Download Button"
        info={
          <>
            <strong>No store badges yet</strong>
            <p>
              The app is not on the App Store or Google Play yet, so every button here links to the
              tickets page, which explains how to install it.
            </p>
          </>
        }
        links={[
          <Link key="e" href="/tools/app-adoption/app-adoption-email">
            Adoption email
          </Link>,
          <Link key="s" href="/tools/app-adoption/social-media">
            Social posts
          </Link>,
          <Link key="g" href="/tools/app-adoption/downloadable-graphics">
            Downloadable graphics
          </Link>,
        ]}
      />

      <Panel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
          <div>
            <QrSymbol text={href} px={168} label={href} />
          </div>
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>Where the button goes</h2>
            <p className="body-2">
              <code>{href}</code>
            </p>
            <p className="body-2" style={{ marginBottom: 0 }}>
              {APP_DISTRIBUTION}
            </p>
          </div>
        </div>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <Snippet
          title="HTML"
          note="For a website or an email."
          text={html}
        />
        <Snippet title="Markdown" text={`[Get the KGC 2027 app](${href})`} />
        <Snippet
          title="Plain text"
          note="For a slide, a sign or a chat message."
          text={`Get the KGC 2027 app: ${href}`}
        />
        <div className="whova-form-label">QR code</div>
        <p className="whova-form-description" style={{ marginBottom: 8, marginTop: 0 }}>
          A vector file for a slide or a printed page.
        </p>
        <QrDownload text={href} />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Store badges and deep links.</strong> Both need the app to be listed.
          </li>
          <li>
            <strong>A copy-to-clipboard button.</strong> That needs client-side JavaScript for a
            gesture the browser already has; select the block and copy.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
