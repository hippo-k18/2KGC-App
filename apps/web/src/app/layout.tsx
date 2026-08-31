import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { CookieConsent } from '@/components/cookie-consent';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { brandingSettings } from '@/lib/data';
import { SITE } from '@/lib/site';
import './globals.css';

/**
 * ── Why this is a function and not the static `metadata` object it was ──────
 *
 * The organizer's Branding Center writes `settings/branding`, and until
 * 2026-08-31 nothing on any surface read it — task 4.1. `tagline` is the field
 * this page can honour: it is the OG description, it is one line of marketing
 * copy, and it is exactly the kind of sentence somebody rewrites the week
 * before the event. Reading Firestore means `metadata` has to become
 * `generateMetadata()`, because a static export cannot await anything.
 *
 * ⚠️ `SITE.tagline` stays as the fallback rather than being deleted. An
 * organizer who has never opened the Branding Center has an empty setting, and
 * an empty setting must not blank the OG description — `brandingSettings()`
 * returns `SETTINGS_DEFAULTS.branding`, whose `tagline` is `''`, so the check
 * below is the thing standing between an untouched install and a social card
 * with no description on it.
 *
 * ⚠️ What this does *not* do is make every page dynamic. A route that Next
 * prerenders at build time bakes the tagline it saw then; the thirteen routes
 * that declare `force-dynamic` — which is every route that reads Firestore for
 * its body, including the three prose pages this change makes editable —
 * regenerate it per request. Forcing the whole site dynamic to make one meta
 * tag live is the wrong trade, and the per-route `force-dynamic` convention
 * this app already follows is the right place to make that decision.
 */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await brandingSettings();
  const tagline = branding.tagline || SITE.tagline;

  return {
    /**
     * Resolves the relative OG image below to an absolute URL. Not a secret and
     * not a Firebase config — it is the public address of this site — but it is
     * still read from the environment so a preview deployment does not advertise
     * production's URL in its meta tags.
     */
    metadataBase: new URL(process.env.WEB_PUBLIC_ORIGIN ?? 'http://localhost:3200'),
    title: {
      default: `${SITE.name} · ${SITE.datesShort}`,
      template: `%s · ${SITE.shortName} 2027`,
    },
    description: `${SITE.name}. ${SITE.datesLong}, ${SITE.venue}. Five days of workshops, talks and the people building the semantic layer under enterprise AI.`,
    icons: { icon: '/favicon.png' },
    openGraph: {
      title: `${SITE.name} · ${SITE.datesShort}`,
      description: tagline,
      images: ['/hero-kgc.png'],
      type: 'website',
    },
  };
}

/**
 * The live-site comparison overlay — development only, and genuinely absent
 * from production rather than merely hidden there.
 *
 * The obvious form, a static import rendered behind
 * `{process.env.NODE_ENV === 'development' && <ReferenceOverlay />}`, does not
 * do that. Next does inline `NODE_ENV`, so the element never renders — but the
 * import is still a static dependency of this module, so webpack bundles the
 * component anyway. Checked, not assumed: the built `layout` chunk contained
 * the overlay's markup strings.
 *
 * A ternary around `dynamic()` fixes it. The condition folds to `false` at build
 * time, the `dynamic()` call is removed with the dead branch, and the only
 * reference to the component is the `import()` inside it — so nothing pulls the
 * module into any chunk.
 *
 * No `ssr: false`: this is a Server Component and Next rejects that option here.
 * It is not needed — the overlay is a client component that renders only its
 * small toggle button until an effect reads the saved state, so there is nothing
 * for the server to get wrong.
 */
const ReferenceOverlay =
  process.env.NODE_ENV === 'development'
    ? dynamic(() => import('@/components/reference-overlay').then((m) => m.ReferenceOverlay))
    : () => null;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /*
   * The footer's contact address is the one place `supportEmail` is wired.
   *
   * ⚠️ `SITE.contactEmail` is deliberately NOT repointed at this setting. It
   * has thirteen call sites and several of them are client components, which
   * cannot read Firestore at all; turning the constant into a fetch would
   * either break them or drag a server read into the browser bundle. So the
   * resolved address is passed down as a prop to the one server-rendered place
   * that renders it site-wide, and the other twelve stay on the constant until
   * somebody decides, per call site, that they should not.
   *
   * `brandingSettings()` is `cache()`d, so this and `generateMetadata()` above
   * cost one document read between them.
   */
  const branding = await brandingSettings();

  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter contactEmail={branding.supportEmail || SITE.contactEmail} />
        <CookieConsent />
        <ReferenceOverlay />
      </body>
    </html>
  );
}
