'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/** iOS Safari's extra static on `DeviceOrientationEvent`. Absent everywhere else. */
type OrientationWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * The stage the pass sits on. It works out where the light is and hands it to
 * CSS as `--px` / `--py` (0–1 across the stage, resting at 0.5), and CSS does
 * the rest: the tilt, the shadow, the foil, the glitter and the glare. See
 * `.pass-stage` in `globals.css`.
 *
 * Three things can move the light, in this order of precedence:
 *
 *   1. A finger on the pass. It tilts toward the finger while the finger is
 *      down and springs back on release. `touch-action: pan-y` on the stage
 *      means a vertical swipe still scrolls the page: the browser takes that
 *      gesture, sends `pointercancel`, and the pass springs back.
 *   2. A mouse or pen hovering over it.
 *   3. The phone's own tilt (`deviceorientation`), on touch screens only. The
 *      first reading is taken as level, and the baseline drifts slowly after
 *      that, so however the phone is being held becomes the new rest. iOS only
 *      sends these events after `requestPermission()` from a tap, so there the
 *      component shows a small "Tap to tilt" button (a tap on the pass itself
 *      works too). Refused or missing, the pass still answers to a finger.
 *
 * All of it is smoothed by one spring, stepped at a fixed 60Hz inside
 * `requestAnimationFrame` so a 120Hz screen moves at the same speed, and the
 * loop stops once the pass is at rest. Nothing here reads layout per frame:
 * the stage's box is measured when a touch or hover starts, and on scroll or
 * resize. With `prefers-reduced-motion` none of it runs and the pass is still.
 *
 * The pointer is measured against this untransformed wrapper rather than the
 * card itself. A tilted card's bounding box changes as it tilts, so measuring
 * the card feeds its own rotation back into the next reading and it wobbles.
 *
 * The pass inside stays a server render; this only wraps it.
 */
export function PassTilt({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [askMotion, setAskMotion] = useState(false);
  const enableMotion = useRef<(() => void) | null>(null);

  useEffect(() => {
    const stage = ref.current;
    if (!stage) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Offsets from the centre, -0.5 to 0.5 on each axis.
    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;
    let aimX = 0;
    let aimY = 0;
    let held: 'none' | 'hover' | 'touch' = 'none';
    let touchId = -1;

    let tiltX = 0;
    let tiltY = 0;
    let tilting = false;
    let level: { x: number; y: number } | null = null;

    let rect = stage.getBoundingClientRect();
    const measure = () => {
      rect = stage.getBoundingClientRect();
    };

    let frame = 0;
    let last = 0;
    let carry = 0;
    const STEP = 1000 / 60;

    const tick = (now: number) => {
      frame = 0;
      carry = Math.min(carry + (last ? now - last : STEP), STEP * 4);
      last = now;

      const goalX = held !== 'none' ? aimX : tilting ? tiltX : 0;
      const goalY = held !== 'none' ? aimY : tilting ? tiltY : 0;
      // Stiff and well damped under a finger so it follows; softer with a
      // touch of overshoot on release, so letting go reads as a spring.
      const [k, damp] = held !== 'none' ? [0.2, 0.62] : tilting ? [0.12, 0.7] : [0.07, 0.82];
      while (carry >= STEP) {
        carry -= STEP;
        vx = (vx + (goalX - x) * k) * damp;
        vy = (vy + (goalY - y) * k) * damp;
        x += vx;
        y += vy;
      }

      const resting =
        Math.abs(goalX - x) < 0.0008 && Math.abs(goalY - y) < 0.0008 && Math.abs(vx) + Math.abs(vy) < 0.0008;
      if (resting) {
        x = goalX;
        y = goalY;
        vx = 0;
        vy = 0;
      }

      stage.style.setProperty('--px', (0.5 + x).toFixed(4));
      stage.style.setProperty('--py', (0.5 + y).toFixed(4));

      // At rest the loop stops; the next pointer or orientation event restarts it.
      if (resting) {
        last = 0;
        carry = 0;
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const aim = (e: PointerEvent) => {
      aimX = clamp((e.clientX - rect.left) / rect.width, 0, 1) - 0.5;
      aimY = clamp((e.clientY - rect.top) / rect.height, 0, 1) - 0.5;
      wake();
    };

    const enter = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      measure();
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || held === 'touch') return;
      held = 'touch';
      touchId = e.pointerId;
      stage.dataset.touching = '';
      measure();
      aim(e);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        if (held === 'touch' && e.pointerId === touchId) aim(e);
        return;
      }
      held = 'hover';
      aim(e);
    };
    const release = (e: PointerEvent) => {
      if (e.pointerType === 'touch' ? e.pointerId !== touchId : held === 'touch') return;
      held = 'none';
      touchId = -1;
      delete stage.dataset.touching;
      wake();
    };

    stage.addEventListener('pointerenter', enter);
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('pointerleave', release);
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);

    /*
     * The phone's tilt. `gamma` is left–right and `beta` front–back, both in
     * the device's own frame, so they are turned to match the screen when the
     * phone is on its side. 20° either way from level is the full tilt.
     */
    const orient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      const angle = screen.orientation?.angle ?? 0;
      const [sx, sy] =
        angle === 90
          ? [e.beta, -e.gamma]
          : angle === 270 || angle === -90
            ? [-e.beta, e.gamma]
            : angle === 180
              ? [-e.gamma, -e.beta]
              : [e.gamma, e.beta];
      if (!level) level = { x: sx, y: sy };
      level.x += (sx - level.x) * 0.004;
      level.y += (sy - level.y) * 0.004;
      tiltX = clamp((sx - level.x) / 40, -0.5, 0.5);
      tiltY = clamp((sy - level.y) / 40, -0.5, 0.5);
      tilting = true;
      wake();
    };
    const listen = () => window.addEventListener('deviceorientation', orient);

    const Orientation = window.DeviceOrientationEvent as OrientationWithPermission | undefined;
    const touchScreen = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    let tap: ((e: MouseEvent) => void) | null = null;

    if (touchScreen && Orientation && window.isSecureContext) {
      if (typeof Orientation.requestPermission === 'function') {
        const request = Orientation.requestPermission.bind(Orientation);
        enableMotion.current = () => {
          enableMotion.current = null;
          setAskMotion(false);
          if (tap) stage.removeEventListener('click', tap);
          request()
            .then((answer) => {
              if (answer === 'granted') listen();
            })
            .catch(() => {
              // Refused or unavailable: the finger still works.
            });
        };
        // A tap anywhere on the pass asks as well, except on its link.
        tap = (e: MouseEvent) => {
          if ((e.target as Element).closest('a')) return;
          enableMotion.current?.();
        };
        stage.addEventListener('click', tap);
        setAskMotion(true);
      } else {
        listen();
      }
    }

    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener('pointerenter', enter);
      stage.removeEventListener('pointerdown', down);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', release);
      stage.removeEventListener('pointercancel', release);
      stage.removeEventListener('pointerleave', release);
      if (tap) stage.removeEventListener('click', tap);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('deviceorientation', orient);
      enableMotion.current = null;
    };
  }, []);

  return (
    <>
      <div ref={ref} className="pass-stage">
        {children}
      </div>
      {askMotion ? (
        <p className="pass-motion">
          <button type="button" onClick={() => enableMotion.current?.()}>
            Tap to tilt
          </button>
        </p>
      ) : null}
    </>
  );
}
