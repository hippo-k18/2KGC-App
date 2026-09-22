'use client';

import { useEffect } from 'react';

/**
 * Puts the caret in the field a fragment link points at.
 *
 * The magnifier in the header is `/agenda#agenda-search`. A fragment scrolls
 * the box into view and stops there, so somebody who pressed a search icon was
 * looking at a search box with nothing in it and no cursor, and still had to
 * tap. That is most of the way to a working control and none of the benefit.
 *
 * Two triggers, because a fragment link has two shapes. Arriving from another
 * page mounts this component, and `hashchange` covers pressing the magnifier
 * while already on the agenda, where nothing remounts.
 *
 * `preventScroll` leaves the browser's own fragment scroll alone: focusing
 * would otherwise re-scroll the box to a different place on the screen, and the
 * page would visibly settle twice.
 *
 * Deliberately does nothing on a plain visit to `/agenda`. Focusing a field
 * nobody asked for moves the page on a phone and opens the keyboard over the
 * programme, which is why this is not `autoFocus` on the input.
 */
export function FocusOnHash({ id }: { id: string }) {
  useEffect(() => {
    const focus = () => {
      if (window.location.hash !== `#${id}`) return;
      const field = document.getElementById(id);
      if (field instanceof HTMLInputElement) field.focus({ preventScroll: true });
    };
    focus();
    window.addEventListener('hashchange', focus);
    return () => window.removeEventListener('hashchange', focus);
  }, [id]);

  return null;
}
