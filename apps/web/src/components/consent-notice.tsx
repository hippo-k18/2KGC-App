'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import s from './consent-notice.module.css';

const KEY = 'kgc-consent';
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The cookie notice, matching the one the old WordPress site showed.
 *
 * Complianz ran there in US opt-out mode: a "Manage Consent" card in the
 * bottom-right corner with an Accept button, a close button and a link to the
 * privacy policy, while analytics loaded regardless. This keeps that model: the
 * notice records that it was seen and hides for a year (Complianz's
 * `cookie_expiry`), and tracking is stopped by Do Not Track or Global Privacy
 * Control, checked in the boot script (`lib/analytics.ts`). The copy is the old
 * banner's own. Rendered only while analytics is on.
 */
export function ConsentNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { at?: number } | null;
      setOpen(!(saved?.at && Date.now() - saved.at < YEAR_MS));
    } catch {
      setOpen(true);
    }
  }, []);

  if (!open) return null;

  const close = (choice: 'accept' | 'dismiss') => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ choice, at: Date.now() }));
    } catch {}
    setOpen(false);
  };

  return (
    <div className={s.card} role="dialog" aria-labelledby="consent-title" aria-live="polite">
      <button type="button" className={s.close} aria-label="Close" onClick={() => close('dismiss')}>
        ×
      </button>
      <p id="consent-title" className={s.title}>
        Manage Consent
      </p>
      <p className={s.text}>
        To provide the best experiences, we use technologies like cookies to store and/or access device information.
        Consenting to these technologies will allow us to process data such as browsing behavior or unique IDs on this
        site. Not consenting or withdrawing consent, may adversely affect certain features and functions.
      </p>
      <button type="button" className={s.accept} onClick={() => close('accept')}>
        Accept
      </button>
      <Link href="/privacy" className={s.link}>
        Privacy policy
      </Link>
    </div>
  );
}
