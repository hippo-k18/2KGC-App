import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { CookieConsent } from '@/components/cookie-consent';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { SITE } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
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
    description: SITE.tagline,
    images: ['/hero-kgc.png'],
    type: 'website',
  },
};

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
        <CookieConsent />
        <ReferenceOverlay />
      </body>
    </html>
  );
}
