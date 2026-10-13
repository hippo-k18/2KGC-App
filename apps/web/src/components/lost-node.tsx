'use client';

import { useEffect, useRef } from 'react';

/**
 * The 404, as a node that has lost its edges.
 *
 * A handful of detached orange nodes drift on the canvas, each spawned at a
 * random spot. The real navigation links on the page are the nodes they can
 * attach to: hover or focus one and an edge snaps into existence from the
 * nearest lost node, which drifts toward it while the rest keep wandering. Reconnecting the graph is
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
 * Under `prefers-reduced-motion` it paints a single frame with the nodes already
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

    // The lost nodes, in canvas space. Positions are filled in on the first
    // size() once the canvas has dimensions; each gets a random heading at the
    // same gentle speed the single node used to have.
    const COUNT = 5;
    const SPEED = 0.19;
    const MARGIN = 24;
    const nodes = Array.from({ length: COUNT }, () => {
      const a = Math.random() * Math.PI * 2;
      return { x: 0, y: 0, vx: Math.cos(a) * SPEED, vy: Math.sin(a) * SPEED };
    });
    let placed = false;
    let target: HTMLElement | null = null;

    function size() {
      const r = canvas!.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!placed && w > MARGIN * 2 && h > MARGIN * 2) {
        placed = true;
        for (const n of nodes) {
          n.x = MARGIN + Math.random() * (w - MARGIN * 2);
          n.y = MARGIN + Math.random() * (h - MARGIN * 2);
        }
      }
      // Keep everything on the canvas if it shrinks.
      for (const n of nodes) {
        n.x = Math.min(Math.max(n.x, MARGIN), Math.max(MARGIN, w - MARGIN));
        n.y = Math.min(Math.max(n.y, MARGIN), Math.max(MARGIN, h - MARGIN));
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

      // Only the lost node closest to the hovered link reaches for it.
      let near: (typeof nodes)[number] | null = null;
      if (t) {
        let best = Infinity;
        for (const n of nodes) {
          const d = Math.hypot(t.x - n.x, t.y - n.y);
          if (d < best) {
            best = d;
            near = n;
          }
        }
      }

      if (!reduced) {
        for (const n of nodes) {
          if (n === near && t) {
            // Drawn toward whatever it might attach to, but never all the way —
            // it eases in and stops short, still separate.
            n.x += (t.x - n.x) * 0.045;
            n.y += (t.y - n.y) * 0.045;
          } else {
            n.x += n.vx;
            n.y += n.vy;
            if (n.x < MARGIN || n.x > w - MARGIN) n.vx *= -1;
            if (n.y < MARGIN || n.y > h - MARGIN) n.vy *= -1;
          }
        }
      }

      if (t && near) {
        const d = Math.hypot(t.x - near.x, t.y - near.y);
        ctx!.strokeStyle = `rgba(246,134,33,${Math.max(0.25, 1 - d / 420)})`;
        ctx!.lineWidth = 1.5;
        ctx!.setLineDash([5, 5]);
        ctx!.beginPath();
        ctx!.moveTo(near.x, near.y);
        ctx!.lineTo(t.x, t.y);
        ctx!.stroke();
        ctx!.setLineDash([]);

        ctx!.fillStyle = 'rgba(246,134,33,0.9)';
        ctx!.beginPath();
        ctx!.arc(t.x, t.y, 4, 0, Math.PI * 2);
        ctx!.fill();
      }

      // Each lost node: a filled core inside a hollow ring, so it reads as a
      // node rather than as a dot.
      for (const n of nodes) {
        ctx!.fillStyle = '#f68621';
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, 6, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.strokeStyle = 'rgba(246,134,33,0.35)';
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, 14, 0, Math.PI * 2);
        ctx!.stroke();
      }
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
