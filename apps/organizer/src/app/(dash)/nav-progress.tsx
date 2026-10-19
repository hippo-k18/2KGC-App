'use client';

import { useEffect, useState } from 'react';

/**
 * A thin bar across the top of the page between a click and the next screen.
 *
 * ── Why this and not `loading.tsx` (T286) ──────────────────────────────────
 *
 * `(dash)/loading.tsx` drew a skeleton during navigation, and in doing so put
 * a Suspense boundary around every screen. React 19.2, as bundled by Next
 * 15.5, can lose the retry for a transition that suspends inside a boundary
 * already on screen (the "suspended with delay" state): a link click then did
 * nothing at all, and a save stayed on "Saving…" for ever. On the call editor
 * that was Back failing 4 times in 20 and saves sticking in about a third of
 * tries; with the boundary gone, 0 in 45 and 0 in 30. React 19.3 fixes it.
 *
 * So the skeleton is gone and this says "something is happening" instead,
 * without a boundary. It listens for clicks on same-site links, shows the bar
 * until the address changes (to the link or, after a redirect, anywhere
 * else), and gives up after 15 seconds so a link that
 * goes nowhere new cannot leave it running.
 */
export function NavProgress() {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Capture phase: next/link calls preventDefault in its own handler, so a
      // bubbling listener would see every link click as already handled.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      const next = url.pathname + url.search;
      if (next === location.pathname + location.search) return;
      setTarget(next);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    if (target === null) return;
    const started = Date.now();
    const from = location.pathname + location.search;
    const timer = setInterval(() => {
      // Arrived, or went somewhere else (a redirect), or gave up.
      const here = location.pathname + location.search;
      if (here !== from || Date.now() - started > 15000) setTarget(null);
    }, 100);
    // Back and forward replace whatever was clicked.
    const onPop = () => setTarget(null);
    window.addEventListener('popstate', onPop);
    return () => {
      clearInterval(timer);
      window.removeEventListener('popstate', onPop);
    };
  }, [target]);

  return target === null ? null : <div className="nav-progress" role="progressbar" aria-label="Loading" />;
}
