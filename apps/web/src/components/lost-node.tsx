'use client';

import { useEffect, useRef } from 'react';

/**
 * The 404, as a node that has lost its edges.
 *
 * A detached orange node drifts on the canvas. The real navigation links on the
 * page are the nodes it can attach to: hover or focus one and the edge snaps
 * into existence and the lost node drifts toward it. Reconnecting the graph is
 * the thing the page is asking you to do, so the illustration and the task are
 * the same gesture.
 *
 * ## Why the links are still ordinary links
 *
 * The canvas is `aria-hidden` and `pointer-events: none`, and every anchor it
 * draws to is a real `<a>` in normal flow that works with the canvas removed.
 * The effect reads the links' positions; it never owns them. A keyboard user
 * gets exactly what a mouse user gets, because `focusin` and `pointerover` run
 * the same code path.
 *
 * Under `prefers-reduced-motion` it paints a single frame with the node already
 * adrift and unattached, which is arguably the better picture anyway.
 */
export function LostNode({ targetSelector }: { targetSelector: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;

    // The lost node's own position, in canvas space.
    const node = { x: 0, y: 0, vx: 0.16, vy: 0.11 };
    let target: HTMLElement | null = null;

    function size() {
      const r = canvas!.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (node.x === 0 && node.y === 0) {
        node.x = w * 0.5;
        node.y = h * 0.42;
      }
    }

    /** Centre of the hovered/focused link, in canvas space. */
    function targetPoint() {
      if (!target) return null;
      const c = canvas!.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      return { x: t.left + t.width / 2 - c.left, y: t.top + t.height / 2 - c.top };
    }

    function frame() {
      ctx!.clearRect(0, 0, w, h);
      const t = targetPoint();

      if (!reduced) {
        if (t) {
          // Drawn toward whatever it might attach to, but never all the way —
          // it eases in and stops short, still separate.
          node.x += (t.x - node.x) * 0.045;
          node.y += (t.y - node.y) * 0.045;
        } else {
          node.x += node.vx;
          node.y += node.vy;
          if (node.x < 24 || node.x > w - 24) node.vx *= -1;
          if (node.y < 24 || node.y > h - 24) node.vy *= -1;
        }
      }

      if (t) {
        const d = Math.hypot(t.x - node.x, t.y - node.y);
        ctx!.strokeStyle = `rgba(246,134,33,${Math.max(0.25, 1 - d / 420)})`;
        ctx!.lineWidth = 1.5;
        ctx!.setLineDash([5, 5]);
        ctx!.beginPath();
        ctx!.moveTo(node.x, node.y);
        ctx!.lineTo(t.x, t.y);
        ctx!.stroke();
        ctx!.setLineDash([]);

        ctx!.fillStyle = 'rgba(246,134,33,0.9)';
        ctx!.beginPath();
        ctx!.arc(t.x, t.y, 4, 0, Math.PI * 2);
        ctx!.fill();
      }

      // The lost node: a filled core inside a hollow ring, so it reads as a node
      // rather than as a dot.
      ctx!.fillStyle = '#f68621';
      ctx!.beginPath();
      ctx!.arc(node.x, node.y, 6, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.strokeStyle = 'rgba(246,134,33,0.35)';
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      ctx!.arc(node.x, node.y, 14, 0, Math.PI * 2);
      ctx!.stroke();
    }

    let raf = 0;
    let running = false;
    const start = () => {
      if (running || reduced) return;
      running = true;
      const tick = () => {
        frame();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const links = Array.from(document.querySelectorAll<HTMLElement>(targetSelector));
    const onEnter = (e: Event) => {
      target = e.currentTarget as HTMLElement;
    };
    const onLeave = () => {
      target = null;
    };
    for (const l of links) {
      l.addEventListener('pointerenter', onEnter);
      l.addEventListener('pointerleave', onLeave);
      l.addEventListener('focusin', onEnter);
      l.addEventListener('focusout', onLeave);
    }

    size();
    frame();
    const ro = new ResizeObserver(() => {
      size();
      frame();
    });
    ro.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    start();

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      for (const l of links) {
        l.removeEventListener('pointerenter', onEnter);
        l.removeEventListener('pointerleave', onLeave);
        l.removeEventListener('focusin', onEnter);
        l.removeEventListener('focusout', onLeave);
      }
    };
  }, [targetSelector]);

  return <canvas ref={ref} className="lost-node" aria-hidden="true" />;
}
