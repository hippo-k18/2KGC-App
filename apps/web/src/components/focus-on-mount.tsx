'use client';

import { useEffect } from 'react';

/**
 * Brings the element with `id` into view and gives it focus when rendered.
 *
 * After a form posts and the action redirects back to the same page, the
 * browser stays where the button was, at the bottom of a long page, and the
 * result printed at the top is never seen (T405). The server renders this
 * with a fresh `key` on each result, so a second send focuses again.
 */
export function FocusOnMount({ id, top = false }: { id: string; top?: boolean }) {
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    // `top`: the page itself goes back to the start, header and all.
    if (top) window.scrollTo({ top: 0, behavior: 'instant' });
    else el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  }, [id, top]);
  return null;
}
