'use client';

import { useEffect } from 'react';

/**
 * Puts the window back at the top when the page it is rendered on mounts.
 *
 * The confirmation page is reached by `redirect()` from the checkout server
 * action, which the App Router performs as a *soft* navigation. A soft
 * navigation does not always reset the scroll offset: the buyer submits the
 * form from near the bottom of a long tickets page, the confirmation renders
 * into the same document, and the viewport stays where it was — so the screen
 * the whole purchase exists to reach opens somewhere in its footer, with the
 * claim code above the fold and out of sight.
 *
 * `useEffect` rather than a layout effect so it runs after the confirmation has
 * painted, and `instant` rather than the CSS `scroll-behavior` the site sets
 * globally, because an animated scroll from the bottom of one page to the top
 * of another reads as the page moving on its own.
 *
 * Keyed on nothing: it fires once per mount, which is exactly one arrival.
 */
export function ScrollToTop() {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  return null;
}
