import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { CookieConsent } from '@/components/cookie-consent';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { brandPalette, isHexColor, mixHex } from '@kgc/shared';
import { brandingSettings, siteEvent } from '@/lib/data';
import { canonicalOrigin } from '@/lib/event-jsonld';
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
/**
 * Static routes pick up a saved colour, name or date within a minute instead of
 * at the next build. Routes that declare `force-dynamic` are unaffected.
 */
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const [branding, ev] = await Promise.all([brandingSettings(), siteEvent()]);
  const tagline = branding.tagline || SITE.tagline;

  return {
    /**
     * Resolves the relative OG image below to an absolute URL. Not a secret and
     * not a Firebase config — it is the public address of this site — but it is
     * still read from the environment so a preview deployment does not advertise
     * production's URL in its meta tags.
     *
     * The same `canonicalOrigin()` the JSON-LD uses, so the two formats cannot
     * name different hosts for the same page. It used to be an inline copy of
     * that expression with a `localhost:3200` default, which meant a deploy
     * missing `WEB_PUBLIC_ORIGIN` served social cards whose image URL only
     * resolved on the machine that built them.
     */
    metadataBase: new URL(canonicalOrigin()),
    title: {
      default: `${ev.name} · ${ev.datesShort}`,
      template: `%s · ${ev.shortName} ${ev.year}`,
    },
    description: `${ev.name}. ${ev.datesLong}, ${ev.venue}. Five days of workshops, talks and the people building the semantic layer under enterprise AI.`,
    icons: { icon: '/favicon.png' },
    openGraph: {
      title: `${ev.name} · ${ev.datesShort}`,
      description: tagline,
      images: [branding.bannerUrl || '/hero-kgc.png'],
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

/**
 * The saved brand colours, as overrides of the palette in `globals.css`.
 *
 * The stylesheet hangs every navy surface off `--palette-2` (header, primary
 * button) and every highlight off `--palette-6`, so re-pointing those two, plus
 * the steps derived from them, recolours the site without touching a rule.
 * `brandPalette()` is the same derivation the app uses. Nothing is emitted
 * when no colour is saved, so the stylesheet's own values stand.
 *
 * Both values are checked against the six-digit hex pattern before they reach
 * the `<style>` text, here as well as on save.
 */
function BrandStyle({ brandColor, accentColor }: { brandColor: string; accentColor: string }) {
  const brand = brandPalette(brandColor);
  const lines: string[] = [];
  if (brand) {
    lines.push(
      `--palette-2:${brand.brand}`,
      `--blue-dark:${brand.brandDark}`,
      `--btn-fg:${brand.onBrand}`,
      `--btn-bg-hover:${mixHex(brand.brand, '#FFFFFF', 0.45)}`,
    );
  }
  if (isHexColor(accentColor)) lines.push(`--palette-6:${accentColor.toUpperCase()}`);
  if (lines.length === 0) return null;
  return <style>{`:root{${lines.join(';')}}`}</style>;
}

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
  const [branding, ev] = await Promise.all([brandingSettings(), siteEvent()]);

  return (
    <html lang="en">
      <head>
        <BrandStyle brandColor={branding.brandColor} accentColor={branding.accentColor} />
      </head>
      <body>
        <SiteHeader logoUrl={branding.logoUrl || undefined} eventName={ev.name} />
        <main>{children}</main>
        <SiteFooter
          contactEmail={branding.supportEmail || SITE.contactEmail}
          datesShort={ev.datesShort}
          venue={ev.venue}
        />
        <CookieConsent />
        <ReferenceOverlay />
      </body>
    </html>
  );
}
