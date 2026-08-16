'use client';

import { useEffect, useState } from 'react';

const KEY = 'kgc-cookie-choice';

/**
 * Cookie notice.
 *
 * The honest version: this site sets no analytics or advertising cookies at
 * all — there is no third-party script on any page — so the banner is a notice
 * rather than a consent gate, and it does not block anything while it is
 * showing. The choice is remembered in `localStorage`, which is itself
 * first-party functional storage and needs no consent under the ePrivacy
 * carve-out. If a marketing tag is ever added, this component has to become a
 * real gate that withholds the tag until "Accept" is clicked.
 *
 * Rendered only after mount so the server HTML and the first client render
 * agree — reading `localStorage` during render is a hydration mismatch.
 */
export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(KEY)) setShow(true);
    } catch {
      // Storage blocked entirely (private mode, hardened browser). Showing the
      // notice every visit is worse than not showing it, so stay quiet.
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, 'ack');
    } catch {
      /* nothing to remember it with; hiding for this page load is enough */
    }
    setShow(false);
  };

  return (
    <div className="consent" role="region" aria-label="Cookie notice">
      <p>
        We use one first-party cookie to keep your ticket checkout session together. No advertising
        trackers, no third-party analytics.
      </p>
      <button type="button" className="btn btn-primary btn-sm" onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}
