'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * One control that opens every card at once, for the reader who wants the
 * whole comparison rather than one ticket.
 *
 * It is an *enhancement*, not the mechanism. The cards are plain `<details>`
 * and work on their own; this button drives them through the same `open`
 * property the summary toggles, so a card opened by hand and a card opened by
 * the button end up in the same state, and nothing here is needed for the page
 * to be usable. It renders nothing until it has mounted, so a reader without
 * JavaScript is never shown a dead button.
 */
export function ExpandAll({ targetId, className }: { targetId: string; className?: string }) {
  const [ready, setReady] = useState(false);
  const [allOpen, setAllOpen] = useState(false);

  const panels = useCallback((): HTMLDetailsElement[] => {
    const root = document.getElementById(targetId);
    return root ? Array.from(root.querySelectorAll<HTMLDetailsElement>('details')) : [];
  }, [targetId]);

  useEffect(() => {
    setReady(true);
    const root = document.getElementById(targetId);
    if (!root) return;
    const sync = () => {
      const found = Array.from(root.querySelectorAll<HTMLDetailsElement>('details'));
      setAllOpen(found.length > 0 && found.every((panel) => panel.open));
    };
    sync();
    // `toggle` does not bubble, so listen on the way down instead.
    root.addEventListener('toggle', sync, true);
    return () => root.removeEventListener('toggle', sync, true);
  }, [targetId]);

  if (!ready) return null;

  return (
    <button
      type="button"
      className={className}
      aria-expanded={allOpen}
      onClick={() => {
        const next = !allOpen;
        for (const panel of panels()) panel.open = next;
        setAllOpen(next);
      }}
    >
      {allOpen ? 'Close every list' : 'Open every list to compare'}
    </button>
  );
}
