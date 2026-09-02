import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { publicUrl } from '@/lib/webpages';
import { SettingsReach } from '../../../settings-reach';
import { Banner, GapPanel, PageHeader, Panel } from '../../../ui';
import { BrandedUrlForm } from '../branding-forms';

export const dynamic = 'force-dynamic';

/**
 * Content › Branding Center › Branded Event URL.
 *
 * Whova sells a vanity address — `whova.com/portal/kgc_2027` becomes
 * `kgc2027.whova.com` — because the generated one is unprintable. We do not have
 * that problem in the same shape: the conference already owns
 * `knowledgegraph.tech` and `apps/web` already serves it, so what was missing
 * was never a domain — only a route that resolves a slug to an event.
 *
 * ── That route now exists, and this screen changed with it ──────────────────
 *
 * `apps/web/src/app/[slug]/page.tsx` reads this settings document per request
 * and redirects an exact, case-folded match to `/`. This screen used to have to
 * tell an organizer that the address they had just chosen did not resolve; that
 * copy has come down, which is the whole point of writing it as a caveat rather
 * than as a feature.
 *
 * The slug was worth storing before it was worth serving, and that ordering is
 * still the reason the field exists: the address goes onto printed material and
 * into a QR code months before anyone types it, and the expensive failure is
 * two people printing two different strings.
 */
export default async function BrandedEventUrlPage() {
  await requireOrganizer();

  const s = await readSettings(SETTINGS_KEYS.branding);
  const slug = s.brandedSlug;

  return (
    <>
      <PageHeader
        title="Branded Event URL"
        links={[
          <Link key="a" href="/content/branding-center/app-branding">
            App Branding
          </Link>,
          <Link key="w" href="/marketing/event-website">
            Event Website
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>Reserved, and now served.</strong> Saving a word here writes it to the{' '}
        <code>branding</code> settings document, and{' '}
        <code>apps/web/src/app/[slug]/page.tsx</code> reads that document on every request and
        redirects the matching address to the front page. Change the word and the old address stops
        working the same minute — the redirect is a <strong>307</strong> rather than a 308 precisely
        so that a browser cannot cache a slug you have since withdrawn. Anything that is not an
        exact, case-folded match renders the site&rsquo;s own 404, so this route swallows nothing.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The address</h2>
        <BrandedUrlForm brandedSlug={slug} />
        {slug && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Live at <code>{publicUrl(`/${slug}`)}</code> — it redirects to the front page.
          </p>
        )}
        {s.updatedBy && (
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Last changed by {s.updatedBy}
            {s.updatedAt ? ` on ${s.updatedAt.slice(0, 10)}` : ''}.
          </p>
        )}
      </Panel>

      <SettingsReach
        bag={SETTINGS_KEYS.branding}
        fields={['brandedSlug']}
        style={{ marginTop: 16 }}
      />

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>A landing page of its own.</strong> The route exists and redirects; it does not
            render anything. That is the deliberate half — a second homepage at a second address is
            two pages to keep in step and two URLs in Google for one conference. If the branded
            address ever needs its own content rather than its own door, that is a new decision, not
            an unfinished one.
          </li>
          <li>
            <strong>A subdomain.</strong> <code>kgc2027.knowledgegraph.tech</code> needs a DNS
            record and a certificate somebody has to own. A path is free and does the same job on a
            flyer.
          </li>
          <li>
            <strong>Uniqueness.</strong> One event, one slug, so nothing checks for a collision.
            That assumption is fine now and is the first thing to break if this dashboard ever runs
            two events.
          </li>
          <li>
            <strong>A deep link into the app.</strong> Whova&rsquo;s branded URL opens the mobile
            app if it is installed. That is an associated-domains file and an{' '}
            <code>app.json</code> intent filter, neither of which exists, and it needs a development
            build rather than Expo Go.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
