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
export function FocusOnMount({ id }: { id: string }) {
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  }, [id]);
  return null;
}
