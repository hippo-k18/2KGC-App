import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { isUploadedImageUrl } from '@/lib/uploads';
import { SettingsReach } from '../../../settings-reach';
import { GapPanel, PageHeader, Panel } from '../../../ui';
import { AppBrandingForm } from '../branding-forms';

export const dynamic = 'force-dynamic';

/**
 * Content › Branding Center › App Branding.
 *
 * Everything on this form has a reader. The website's root layout turns the two
 * colours into its navy and highlight custom properties and shows the logo and
 * banner; the app's `useTheme()` lays the brand colour over its header, tint
 * and accent, and its sign-in and Home screens show the logo, tagline, support
 * address and banner. Both keep their built-in look for any field left empty.
 *
 * `SETTINGS_REGISTER.branding` in `@kgc/shared` is the per-field record of
 * that, and the reach table below is rendered from it.
 */
export default async function AppBrandingPage() {
  await requireOrganizer();

  const s = await readSettings(SETTINGS_KEYS.branding);

  return (
    <>
      <PageHeader
        title="App Branding"
        info={
          <>
            <strong>Branding</strong>
            <p>
              Colours, logo, banner, tagline and support address. The website and the attendee app
              use what is saved here.
            </p>
          </>
        }
        links={[
          <Link key="b" href="/content/basics">
            Basics
          </Link>,
          <Link key="u" href="/content/branding-center/branded-event-url">
            Branded Event URL
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Branding</h2>
        <AppBrandingForm
          brandColor={s.brandColor}
          accentColor={s.accentColor}
          tagline={s.tagline}
          supportEmail={s.supportEmail}
          hashtag={s.hashtag}
          logoUrl={s.logoUrl}
          bannerUrl={s.bannerUrl}
          logoIsLink={Boolean(s.logoUrl) && !isUploadedImageUrl(s.logoUrl)}
          bannerIsLink={Boolean(s.bannerUrl) && !isUploadedImageUrl(s.bannerUrl)}
        />
        {s.updatedBy && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Last changed by {s.updatedBy}
            {s.updatedAt ? ` on ${s.updatedAt.slice(0, 10)}` : ''}.
          </p>
        )}
      </Panel>

      <SettingsReach
        bag={SETTINGS_KEYS.branding}
        fields={['brandColor', 'accentColor', 'tagline', 'supportEmail', 'hashtag', 'logoUrl', 'bannerUrl']}
        style={{ marginTop: 16 }}
      />

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>A preview.</strong> A phone mock-up here would have to fake it, and a mock-up
            of a change that does not happen is the worst version of this screen available.
          </li>
          <li>
            <strong>Email colours.</strong> Emails keep their built-in header colour.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
