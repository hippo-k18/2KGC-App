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
 * `knowledgegraph.tech` and `apps/web` already serves it, so what is missing is
 * not a domain but a route that resolves a slug to an event.
 *
 * The slug is worth storing anyway, and earlier than it is worth serving: the
 * address goes onto printed material and into a QR code months before anything
 * answers it, and the expensive failure is two people printing two different
 * strings.
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
        <strong>Reserved, not served.</strong> Saving a word here writes it to the{' '}
        <code>branding</code> settings document and nothing else. No DNS record, no redirect and no
        route in <code>apps/web</code> answers it, so the address below does not currently load.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The address</h2>
        <BrandedUrlForm brandedSlug={slug} />
        {slug && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Would be <code>{publicUrl(`/${slug}`)}</code> once something serves it.
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
            <strong>The route.</strong> <code>apps/web</code> has no{' '}
            <code>/[slug]</code> segment, so the reserved word 404s. Adding one is small — a page
            that reads this settings document and renders the event landing content — but it is a
            change to the public site, not to this dashboard. It is written up as{' '}
            <strong>FU-11</strong> in <code>docs/audit-2026-08-30/FOLLOW-UPS.md</code>, naming the
            file, the line and the function to call.
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
