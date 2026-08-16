import type { Metadata } from 'next';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
        <CookieConsent />
      </body>
    </html>
  );
}
