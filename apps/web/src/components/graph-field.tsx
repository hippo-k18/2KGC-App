'use client';

import { useEffect, useRef } from 'react';

/**
 * A live knowledge graph drawn over the hero photograph.
 *
 * Nodes drift, edges appear between nodes that are close enough, and the pointer
 * is itself a node — so moving across the hero pulls new relationships into
 * existence and lets them lapse again. That is the one interaction on this page
 * that is *about* the subject rather than decorating it: the KGC wordmark is a
 * wireframe mesh, the conference is about graphs, and the hero was a still photo.
 *
 * ## Why this is hand-written rather than a dependency
 *
 * `tsparticles`, `particles-bg` and the several `interactive-particle-network`
 * forks all do this well and are all free. They are also 40–150KB of JavaScript
 * on the largest render-blocking screen of the site, configured through an
 * options object, to draw two primitives — a filled arc and a line. This file is
 * eighty lines and adds nothing to the dependency tree, which matters more than
 * usual here: `globals.css` already documents a deliberate policy of no
 * third-party requests, because the site ships a cookie-consent banner and every
 * external fetch is another entry in it.
 *
 * ## What it will not do
 *
 * **Run when the visitor has asked for less motion.** `prefers-reduced-motion`
 * is honoured by drawing one static frame and stopping — the graph is still
 * there, it simply does not move.
 *
 * **Run off-screen.** The loop stops when the hero scrolls out of view and when
 * the tab is hidden, so it costs nothing on a page nobody is looking at.
 *
 * **Cost anything on a phone.** Node count scales with area and is capped, so a
 * 393px screen gets about 18 nodes rather than the 70 a desktop gets.
 */
export function GraphField() {
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
    let nodes: { x: number; y: number; vx: number; vy: number }[] = [];
    const pointer = { x: -9999, y: -9999 };

    /** ~1 node per 17,000 css px², clamped so phones stay cheap and 5K stays sane. */
    function build() {
      const rect = canvas!.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(14, Math.min(80, Math.round((w * h) / 17000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
      }));
    }

    const LINK = 168; // px at which two nodes stop being related
    const PULL = 210; // px at which the pointer starts joining the graph

    function frame() {
      ctx!.clearRect(0, 0, w, h);

      for (const n of nodes) {
        if (!reduced) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < 0 || n.x > w) n.vx *= -1;
          if (n.y < 0 || n.y > h) n.vy *= -1;
        }
      }

      // Edges first, so nodes sit on top of their own connections.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d = Math.hypot(dx, dy);
          if (d > LINK) continue;
          ctx!.strokeStyle = `rgba(255,255,255,${(1 - d / LINK) * 0.22})`;
          ctx!.lineWidth = 1;
          ctx!.beginPath();
          ctx!.moveTo(nodes[i].x, nodes[i].y);
          ctx!.lineTo(nodes[j].x, nodes[j].y);
          ctx!.stroke();
        }
      }

      for (const n of nodes) {
        const d = Math.hypot(n.x - pointer.x, n.y - pointer.y);
        if (d < PULL) {
          // The cursor's own edges are warmer and brighter than the ambient mesh,
          // so it reads as "you are part of this graph" rather than as a glow.
          ctx!.strokeStyle = `rgba(141,204,238,${(1 - d / PULL) * 0.55})`;
          ctx!.lineWidth = 1;
          ctx!.beginPath();
          ctx!.moveTo(n.x, n.y);
          ctx!.lineTo(pointer.x, pointer.y);
          ctx!.stroke();
        }
        ctx!.fillStyle = d < PULL ? 'rgba(141,204,238,0.95)' : 'rgba(255,255,255,0.55)';
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, d < PULL ? 2.6 : 1.8, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    let raf = 0;
    let running = false;
    function start() {
      if (running || reduced) return;
      running = true;
      const tick = () => {
        frame();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
    };
    const onLeave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
    };

    build();
    frame(); // one frame regardless, so reduced-motion still sees the graph

    const ro = new ResizeObserver(() => {
      build();
      frame();
    });
    ro.observe(canvas);

    // Only animate while actually on screen and in a visible tab.
    const io = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting && !document.hidden ? start() : stop()),
      { threshold: 0 },
    );
    io.observe(canvas);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  // `aria-hidden`: it carries no information a screen reader could use, and the
  // hero's actual content is live text directly above it.
  return <canvas ref={ref} className="graph-field" aria-hidden="true" />;
}
