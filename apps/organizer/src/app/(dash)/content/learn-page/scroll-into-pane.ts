import { scrollTopFor } from '@/lib/learn-shell-core';

/** The nearest ancestor that scrolls vertically. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * Scrolls only the pane that holds `el`, so the element sits well inside it
 * rather than on its bottom edge (T325, E F9). `scrollIntoView` with
 * "nearest" left a block chosen from the Checker just below the fold, and it
 * also scrolls every ancestor, which can shift the whole editor. Nothing
 * moves when the element is already in full view.
 */
export function scrollIntoPane(el: Element | null | undefined, opts: { smooth?: boolean } = {}): void {
  if (!(el instanceof HTMLElement)) return;
  const pane = scrollParent(el);
  if (!pane) return;
  const p = pane.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const top = r.top - p.top;
  const inView = top >= 0 && (r.bottom <= p.bottom || (r.height > p.height && top < p.height / 3));
  if (inView) return;
  const next = scrollTopFor({ scrollTop: pane.scrollTop, paneHeight: pane.clientHeight, top, height: r.height });
  pane.scrollTo({ top: next, behavior: opts.smooth ? 'smooth' : 'auto' });
}
