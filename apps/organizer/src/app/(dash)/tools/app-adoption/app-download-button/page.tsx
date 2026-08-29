import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { Banner, GapPanel, PageHeader, Panel } from '../../../ui';
import { APP_IS_ON_STORES, EXPO_GO_URL, siteOrigin } from '../adoption-context';

export const dynamic = 'force-dynamic';

/**
 * Tools › App Adoption › App Download Button.
 *
 * ── The snippets below are honest about a thing Whova's are not ─────────────
 *
 * Whova gives you App Store and Google Play badges. This app is on neither —
 * it runs in Expo Go — so a store badge would be a button that goes nowhere,
 * pasted by an organizer onto a page a thousand people read. That failure has
 * already happened once on this project: the order confirmation told buyers to
 * search the App Store, and `site.ts` carries a long comment about it.
 *
 * So the snippets link to the tickets page, which explains the real route in
 * one sentence that the owner can change in one place.
 */
export default async function AppDownloadButtonPage() {
  await requireOrganizer();
  const origin = siteOrigin();
  const href = `${origin}/tickets`;

  const html = `<a href="${href}"
   style="display:inline-block;background:#263759;color:#fff;text-decoration:none;
          padding:12px 24px;border-radius:6px;font-family:sans-serif;font-weight:600;">
  Get the KGC 2027 app
</a>`;

  const markdown = `[Get the KGC 2027 app](${href})`;

  const plain = `Get the KGC 2027 app: ${href}`;

  return (
    <>
      <PageHeader
        title="App Download Button"
        links={[
          <Link key="e" href="/tools/app-adoption/app-adoption-email">
            Adoption email
          </Link>,
          <Link key="s" href="/tools/app-adoption/social-media">
            Social posts
          </Link>,
        ]}
      />

      {!APP_IS_ON_STORES && (
        <Banner kind="warning">
          <strong>There are no store badges here on purpose.</strong> The app is not listed on the
          App Store or Google Play — it runs in Expo Go — so an App Store badge would be a button
          that goes nowhere, pasted somewhere a thousand people read it. Every snippet below points
          at the tickets page, which explains the real route in a sentence the owner controls.
        </Banner>
      )}

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>HTML</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          For a WordPress block, an email, or anywhere that takes raw HTML.
        </p>
        <pre className="whova-code">{html}</pre>

        <h2 className="section-header">Markdown</h2>
        <pre className="whova-code">{markdown}</pre>

        <h2 className="section-header">Plain text</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          For a slide, a printed sign, or a Slack message.
        </p>
        <pre className="whova-code">{plain}</pre>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Where the link goes</h2>
        <p className="body-2">
          <code>{href}</code> — the tickets page, which carries the one sentence about how the app
          is distributed. That sentence lives in <code>site.ts</code> and in this dashboard&rsquo;s{' '}
          <code>adoption-context.ts</code>, and both change on the day the app is actually listed.
        </p>
        <p className="body-2">
          Expo Go itself is at <a href={EXPO_GO_URL}>{EXPO_GO_URL}</a> if somebody asks what it is.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>A QR code.</strong> The app has a dependency-free QR encoder for badges
            (<code>app/src/lib/qr/encode.ts</code>) and this dashboard does not use it. Worth
            wiring — a printed QR on a table sign is how people actually install a conference app.
          </li>
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
