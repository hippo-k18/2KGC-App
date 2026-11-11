'use client';

import { useEffect } from 'react';
import type { PurchasePayload } from '@/lib/analytics';

declare global {
  interface Window {
    kgcAnalytics?: boolean;
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Sends the GA4 `purchase` event for the order just paid, once.
 *
 * The checkout return route sets a short-lived cookie with the purchase (see
 * `checkout/return/route.ts`), and only the confirmation page it redirects to
 * renders this. The cookie is cleared after the first send, and a per-order
 * flag in localStorage stops a reload or a second tab from sending it again.
 * Nothing is sent when analytics is off or the browser asked not to be
 * tracked: `window.kgcAnalytics` is set by the boot script in `lib/analytics.ts`.
 */
export function PurchaseEvent({ purchase, cookie }: { purchase: PurchasePayload; cookie: string }) {
  useEffect(() => {
    document.cookie = `${cookie}=; Path=/order; Max-Age=0; SameSite=Lax`;
    if (!window.kgcAnalytics || typeof window.gtag !== 'function') return;
    const key = `kgc-ga-purchase:${purchase.transaction_id}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, String(Date.now()));
    } catch {}
    const { transaction_id, value, currency, items } = purchase;
    window.gtag('event', 'purchase', { transaction_id, value, currency, items });
  }, [purchase, cookie]);
  return null;
}
