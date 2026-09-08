import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { SettingsReach } from '../../../settings-reach';
import { GapPanel, PageHeader, Panel } from '../../../ui';
import { AppBrandingForm } from '../branding-forms';

export const dynamic = 'force-dynamic';

/**
 * Content › Branding Center › App Branding.
 *
 * ── Why the colour field does not colour anything ───────────────────────────
 *
 * The Expo app reads its palette from `app/src/constants/theme.ts`, which is a
 * TypeScript module compiled into the bundle. A hex saved here would have to be
 * fetched at runtime, threaded through `useTheme()` and given a fallback for the
 * first paint before any network call returns — that is a change to how the app
 * boots, not a settings write. So this screen records the decision and says
 * plainly that it records it.
 *
 * That claim is not left to this comment: `SETTINGS_REGISTER.branding` in
 * `@kgc/shared` marks both colours `recorded`, the save message is built from
 * it, and the reach table below is rendered from it. A surface that starts
 * reading a field flips one entry there and this screen follows.
 *
 * The logo and banner halves are not a form either, and the reason changed in
 * September 2026: uploading is no longer the blocker. The bucket is live and
 * `lib/uploads.ts` writes to it — sponsor, exhibitor and speaker images all go
 * through it. What is still missing is a *reader*. The app's logo and palette
 * are compiled into the bundle, so a file stored here would reach no phone, and
 * a picker whose result nothing renders is the capability-claiming defect
 * AGENTS.md counts fourteen instances of. The app learning to read its branding
 * at runtime is the change that unblocks this, and it is an `app/` change.
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
            <strong>Recorded, not applied</strong>
            <p>
              The palette ships inside the app bundle and is fixed at build time, so a colour saved
              here reaches no phone until the app reads its theme at runtime. This is where the
              decision is written down.
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
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Text</h2>
        <AppBrandingForm
          brandColor={s.brandColor}
          accentColor={s.accentColor}
          tagline={s.tagline}
          supportEmail={s.supportEmail}
          hashtag={s.hashtag}
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
        fields={['brandColor', 'accentColor', 'tagline', 'supportEmail', 'hashtag']}
        style={{ marginTop: 16 }}
      />

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Logo, banner and header upload.</strong> Not blocked on Storage any more — the
            bucket is live and <code>lib/uploads.ts</code> writes to it. Blocked on a reader: the
            app compiles its logo in, so a stored file would reach nobody.
          </li>
          <li>
            <strong>A preview.</strong> A phone mock-up here would have to fake it, and a mock-up
            of a change that does not happen is the worst version of this screen available.
          </li>
          <li>
            <strong>Contrast checking.</strong> <code>constants/theme.ts</code> documents which
            pairings fail WCAG AA. A colour picked here is checked by nobody.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
