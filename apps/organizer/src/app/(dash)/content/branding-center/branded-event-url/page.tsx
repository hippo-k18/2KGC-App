import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { publicUrl } from '@/lib/webpages';
import { SettingsReach } from '../../../settings-reach';
import { GapPanel, PageHeader, Panel } from '../../../ui';
import { BrandedUrlForm } from '../branding-forms';

export const dynamic = 'force-dynamic';

/**
 * Content › Branding Center › Branded Event URL.
 *
 * A vanity address for the event. The conference already owns
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
        info={
          <>
            <strong>Changing the word breaks the old address</strong>
            <p>
              The address sends visitors to the front page of the event website. If you change it,
              links to the old address stop working.
            </p>
          </>
        }
        links={[
          <Link key="a" href="/content/branding-center/app-branding">
            App Branding
          </Link>,
          <Link key="w" href="/marketing/event-website">
            Event Website
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The address</h2>
        <BrandedUrlForm brandedSlug={slug} />
        {slug && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Live at <code>{publicUrl(`/${slug}`)}</code>. It redirects to the front page.
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
            <strong>A deep link into the app.</strong> Opening the mobile app from this address
            needs an associated-domains file and an <code>app.json</code> intent filter, neither of
            which exists, plus a development build rather than Expo Go.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
