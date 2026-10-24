'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps a page that is left on a screen up to date.
 *
 * Every page in this site renders on the server, so a browser parked on a URL
 * shows whatever was true when it loaded. On a laptop that is invisible; on a
 * panel in a foyer or outside a room it is the whole problem, because nobody is
 * standing there to press reload and the stale page looks exactly like a fresh
 * one.
 *
 * `router.refresh()` re-runs the server component and swaps the result in
 * without a navigation, so the page does not flash white every minute and
 * anything the visitor has scrolled to stays where it was. The route has to be
 * `force-dynamic` for it to fetch anything new, which both callers are.
 *
 * ── It says when it last managed it ────────────────────────────────────────
 *
 * A screen that has quietly stopped updating is worse than one that admits it,
 * for the same reason the dashboard's room view carries the same line: the
 * numbers on the wall still look live. The timestamp is written after the
 * refresh resolves, so a venue wifi drop stops it moving and the sign says so
 * rather than going on claiming to be current.
 *
 * Rendered server-side as nothing at all — the first paint is the timestamp's
 * absence, not a time that came from the server's clock and would differ from
 * the browser's.
 */
export function AutoRefresh({ seconds, label = 'Updated' }: { seconds: number; label?: string }) {
  const router = useRouter();
  const [at, setAt] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const timer = setInterval(() => {
      try {
        router.refresh();
        if (cancelled) return;
        setAt(new Date().toLocaleTimeString('en-GB', { hour12: false }).slice(0, 5));
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }, seconds * 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [router, seconds]);

  return (
    <span className="auto-refresh" aria-live="off">
      {failed ? 'Not updating. Check this screen.' : at ? `${label} ${at}` : cadence(seconds)}
    </span>
  );
}

/** "Updates every minute", not "updated every 1 minutes". */
function cadence(seconds: number): string {
  if (seconds < 60) return `Updates every ${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'Updates every minute' : `Updates every ${minutes} minutes`;
}
