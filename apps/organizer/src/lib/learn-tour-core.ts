/**
 * Pure parts of the Learn editor's first-run tour (`tour.tsx`).
 */

/** A vertical extent in window pixels. */
export interface Span {
  top: number;
  bottom: number;
}

/** Room left between the target and a bar that covers it. */
export const COVER_PAD = 8;

/**
 * How far to scroll a pane (positive is down) so `target` is clear of the
 * elements drawn over it, such as a sticky bar at the bottom of the list
 * (T326 D5b: "Add a section" sat under the outline's Copy and Paste bar after
 * `scrollIntoView`). A cover in the lower half of the scrolling `pane` is a
 * bar along its bottom and limits the bottom of the visible part, any other
 * cover its top; the target's own position does not say which, since a bar
 * can cover all of it. Zero when nothing covers it. The browser clamps the
 * scroll, so at the end of a list the target stops where the list ends, which
 * is above a sticky bar.
 */
export function scrollToClear(target: Span, covers: readonly Span[], pane: Span, pad = COVER_PAD): number {
  const mid = (s: Span) => (s.top + s.bottom) / 2;
  let top = -Infinity;
  let bottom = Infinity;
  for (const c of covers) {
    if (c.bottom <= target.top || c.top >= target.bottom) continue;
    if (mid(c) > mid(pane)) bottom = Math.min(bottom, c.top);
    else top = Math.max(top, c.bottom);
  }
  if (target.bottom > bottom) return target.bottom - bottom + pad;
  if (target.top < top) return target.top - top - pad;
  return 0;
}
