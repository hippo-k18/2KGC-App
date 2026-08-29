import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { Banner, GapPanel, PageHeader, Panel } from '../../../ui';
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
 * The logo and banner halves are not a form at all, because **no screen in this
 * dashboard can put a file into Firebase Storage.** There is no upload
 * component anywhere in the project, which is also why `SponsorDoc.logoURL` and
 * `ExhibitorDoc.logoURL` are populated by the importer rather than by a person.
 */
export default async function AppBrandingPage() {
  await requireOrganizer();

  const s = await readSettings(SETTINGS_KEYS.branding, {
    brandColor: '',
    accentColor: '',
    tagline: '',
    supportEmail: '',
    hashtag: '',
  });

  return (
    <>
      <PageHeader
        title="App Branding"
        links={[
          <Link key="b" href="/content/basics">
            Basics
          </Link>,
          <Link key="u" href="/content/branding-center/branded-event-url">
            Branded Event URL
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>Saving here records a decision. It does not change the app.</strong> The palette
        ships inside the bundle (<code>app/src/constants/theme.ts</code>) and is fixed at build
        time, so a colour saved on this screen reaches no phone until the app learns to read its
        theme at runtime. Treat this as the place the answer is written down, not the place it takes
        effect.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Text</h2>
        <AppBrandingForm
          brandColor={String(s.brandColor ?? '')}
          accentColor={String(s.accentColor ?? '')}
          tagline={String(s.tagline ?? '')}
          supportEmail={String(s.supportEmail ?? '')}
          hashtag={String(s.hashtag ?? '')}
        />
        {s.updatedBy && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Last changed by {s.updatedBy}
            {s.updatedAt ? ` on ${s.updatedAt.slice(0, 10)}` : ''}.
          </p>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Images</h2>
        <p className="body-2">
          Whova takes a 256×256 logo, a 750×300 banner and an optional 2000×750 web-app header,
          resizes them server-side and serves them from its own CDN. Fonts are explicitly not
          customisable — theirs either.
        </p>
        <p className="body-2">
          There is no upload here because there is no upload anywhere in this project. Firebase
          Storage is provisioned and <code>storage.rules</code> is written, but nothing in the
          dashboard, the website or the app writes a file to it. Building the first one means an
          upload component, a rule that only organizers can pass, a size and dimension check, and
          somewhere to put the resulting URL — after which every other screen that wants an image
          becomes cheap.
        </p>
        <p className="body-2">
          Roughly <strong>2–3 days</strong>, most of it the image pipeline rather than the form.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Anything that applies a colour.</strong> No surface reads the{' '}
            <code>branding</code> settings document — not the app, not{' '}
            <code>apps/web</code>, not this dashboard&rsquo;s own chrome.
          </li>
          <li>
            <strong>Logo, banner and header upload.</strong> No file-upload UI exists in this
            project at all.
          </li>
          <li>
            <strong>A preview.</strong> Whova renders a phone mock-up beside the form. Ours would
            have to fake it, and a mock-up of a change that does not happen is the worst version of
            this screen available.
          </li>
          <li>
            <strong>Contrast checking.</strong> Three of Whova&rsquo;s own default pairings fail
            WCAG AA and <code>constants/theme.ts</code> documents the fixes. A colour picked here is
            checked by nobody.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
