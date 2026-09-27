'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The stage the pass sits on: it tracks the pointer and hands its position to
 * CSS as `--px` / `--py` (0–1 across the stage), and CSS does the rest — the
 * tilt, the moving glare and the glitter that catches it. See `.pass-stage` in
 * `globals.css`.
 *
 * The pointer is measured against this untransformed wrapper rather than the
 * card itself. A tilted card's bounding box changes as it tilts, so measuring
 * the card feeds its own rotation back into the next reading and it wobbles.
 *
 * The pass inside stays a server render; this only wraps it.
 */
export function PassTilt({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = ref.current;
    if (!stage) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let px = 0.5;
    let py = 0.5;

    const paint = () => {
      frame = 0;
      stage.style.setProperty('--px', px.toFixed(4));
      stage.style.setProperty('--py', py.toFixed(4));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const clamp = (n: number) => Math.min(1, Math.max(0, n));

    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const r = stage.getBoundingClientRect();
      px = clamp((e.clientX - r.left) / r.width);
      py = clamp((e.clientY - r.top) / r.height);
      stage.dataset.active = '';
      schedule();
    };
    const leave = () => {
      delete stage.dataset.active;
      px = 0.5;
      py = 0.5;
      schedule();
    };

    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerleave', leave);
    };
  }, []);

  return (
    <div ref={ref} className="pass-stage">
      {children}
    </div>
  );
}
