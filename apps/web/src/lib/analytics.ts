/**
 * Google Analytics 4 and Google Tag Manager, as the old WordPress site ran them.
 *
 * Off unless `ANALYTICS_ENABLED=true`, so staging sends nothing today and the
 * cutover turns it on with the other switches (see
 * orchestrator/reports/T044-cutover-runbook.md). The ids default to the live
 * site's own, read off its markup on 2026-09-29: GA4 `G-ELFFWYH8KE` (loaded
 * directly, as Site Kit did) and GTM `GTM-NSSJN8WV`. That container holds two
 * GA4 click events (`click_register`, `click_tickets`) and a custom HTML tag
 * that loads Apollo.io, and no GA4 configuration of its own, so loading both
 * does not count a page view twice, and the purchase event below is sent once.
 *
 * Deliberately not carried over: the old site's Universal Analytics tag
 * (UA-175160404-1, retired by Google in 2023) and HubSpot's tracking script.
 *
 * Consent follows the old site's Complianz setup: US opt-out. Tracking loads
 * unless the browser sends Do Not Track (Complianz honoured it) or Global
 * Privacy Control. The old site's corner notice with an Accept button is in
 * `components/consent-notice.tsx`, off since 2026-10-03 at the owner's request
 * ("get rid of the cookie notice for now"); `consentNoticeOn()` brings it back.
 * It never changed what loads.
 *
 * Server-side only by convention (this app has no NEXT_PUBLIC_* variables); the
 * layout passes the resolved ids down.
 */
export interface AnalyticsConfig {
  ga4: string;
  gtm: string;
}

/**
 * Whether the cookie notice is shown: `CONSENT_NOTICE=on`, and only while
 * analytics is on. The layout renders the notice and `/privacy` describes it
 * from this one switch, so the page cannot describe a notice nobody sees.
 */
export function consentNoticeOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.CONSENT_NOTICE === 'on' && analyticsConfig(env) !== null;
}

const GA4 = /^G-[A-Z0-9]{4,16}$/;
const GTM = /^GTM-[A-Z0-9]{4,12}$/;

export function analyticsConfig(env: Record<string, string | undefined> = process.env): AnalyticsConfig | null {
  if (env.ANALYTICS_ENABLED !== 'true') return null;
  const ga4 = (env.GA4_MEASUREMENT_ID || 'G-ELFFWYH8KE').trim();
  const gtm = (env.GTM_CONTAINER_ID || 'GTM-NSSJN8WV').trim();
  // The ids go into an inline script, so anything else is refused outright.
  if (!GA4.test(ga4) || !GTM.test(gtm)) return null;
  return { ga4, gtm };
}

/**
 * The inline boot script: consent check, the gtag stub, GA4 config, then both
 * loaders. `cookie_flags` makes the `_ga` cookies `Secure`, which gtag does not
 * do by default; the site is HTTPS-only, so nothing is lost. `Lax` rather than
 * the `None` gtag would pair with it: the cookies are first-party and have no
 * reason to travel on another site's requests (the pentest spec checks this). Runs while the page parses, before anything hydrates, so a purchase
 * event queued by the order page lands in the same `dataLayer`.
 */
export function analyticsBootScript({ ga4, gtm }: AnalyticsConfig): string {
  return `(function(){var w=window,n=navigator,d=document;
var off=n.doNotTrack==='1'||w.doNotTrack==='1'||n.msDoNotTrack==='1'||n.globalPrivacyControl===true;
w.kgcAnalytics=!off;if(off)return;
w.dataLayer=w.dataLayer||[];function gtag(){w.dataLayer.push(arguments);}w.gtag=gtag;
gtag('js',new Date());gtag('config','${ga4}',{cookie_flags:'SameSite=Lax;Secure'});
function load(src){var s=d.createElement('script');s.async=true;s.src=src;d.head.appendChild(s);}
load('https://www.googletagmanager.com/gtag/js?id=${ga4}');
w.dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});
load('https://www.googletagmanager.com/gtm.js?id=${gtm}');
})();`;
}

/** The GA4 `purchase` event's parameters, carried from checkout to the order page. */
export interface PurchasePayload {
  /**
   * The order id (`orders/{id}`). The confirmation page sends the event only
   * when its registration came from this order. The cookie holds nothing else
   * about the buyer: the order number, amount, currency and what was bought, as
   * /privacy says.
   */
  transaction_id: string;
  value: number;
  currency: string;
  items: { item_id: string; item_name: string; price: number; quantity: number }[];
}

export const PURCHASE_COOKIE = 'kgc_purchase';

export function encodePurchase(p: PurchasePayload): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
}

export function decodePurchase(raw: string | undefined): PurchasePayload | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as PurchasePayload;
    if (typeof p.transaction_id !== 'string' || typeof p.value !== 'number' || !Array.isArray(p.items)) return null;
    return p;
  } catch {
    return null;
  }
}
