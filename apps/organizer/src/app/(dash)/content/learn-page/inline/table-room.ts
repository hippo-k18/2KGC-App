import { useEffect, type RefObject } from 'react';

/**
 * While the caret is in a table, its block makes room on the side where the
 * floating text tools sit. They covered the block above, and a click on that
 * block's words went to the tools instead (T348). The room changes only once
 * a press is over, so nothing moves under a click or a drag.
 */
export function useTableRoom(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let down = false;
    let frame = 0;
    let roomed: { block: HTMLElement; side: 'top' | 'bottom'; px: number } | null = null;
    // The tools show and hide by their own style; watch for that too.
    const observer = new MutationObserver(() => schedule());
    const watched = new WeakSet<Element>();
    // Each in-place text field has its own tools; the one showing is the one.
    const bubbles = () => {
      const all = [...document.querySelectorAll<HTMLElement>('.rt-bubble-floating')];
      for (const b of all) {
        if (watched.has(b)) continue;
        watched.add(b);
        observer.observe(b, { attributes: true, attributeFilter: ['style'] });
      }
      return all.find((b) => b.style.visibility !== 'hidden' && b.offsetHeight > 0);
    };

    const clear = () => {
      if (!roomed) return;
      roomed.block.style.removeProperty(`padding-${roomed.side}`);
      roomed.block.removeAttribute('data-table-room');
      roomed = null;
    };
    const settle = () => {
      frame = 0;
      const bubble = bubbles();
      if (down) return;
      const node = window.getSelection()?.anchorNode ?? null;
      const at = node instanceof Element ? node : node?.parentElement;
      const table = at?.closest('table');
      const editor = table?.closest<HTMLElement>('.ProseMirror');
      const block = table?.closest<HTMLElement>('.lp-block');
      if (!table || !editor || !block || !el.contains(block) || !editor.contains(document.activeElement) || !bubble) {
        clear();
        return;
      }
      // The page is drawn zoomed and the tools are not: measured on screen,
      // given in the page's own pixels.
      const rect = block.getBoundingClientRect();
      const zoom = block.offsetHeight ? rect.height / block.offsetHeight : 1;
      const t = table.getBoundingClientRect();
      const b = bubble.getBoundingClientRect();
      const side = b.top + b.height / 2 < t.top + t.height / 2 ? 'top' : 'bottom';
      const px = Math.ceil((bubble.offsetHeight + 12) / (zoom || 1));
      if (roomed && roomed.block === block && roomed.side === side && Math.abs(roomed.px - px) < 2) return;
      clear();
      roomed = { block, side, px };
      block.style.setProperty(`padding-${side}`, `${px}px`);
      block.setAttribute('data-table-room', side);
      // The tools follow the table to its new place.
      window.dispatchEvent(new Event('resize'));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(settle);
    };
    const onDown = () => {
      down = true;
    };
    const onUp = () => {
      down = false;
      // Two frames: the click's own caret placement runs in the first.
      requestAnimationFrame(schedule);
    };
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      clear();
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
    };
  }, [root]);
}
