'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Pins a screenshot of the live site over ours so misalignments are visible.
 *
 * The problem this solves: comparing two tabs by eye finds the big mistakes and
 * misses every small one. A 6px difference in section padding is invisible side
 * by side and obvious the moment the two are superimposed.
 *
 * **Development only.** It is mounted behind a `NODE_ENV` check in
 * `layout.tsx`, so it cannot reach a production bundle. Nothing here runs, and
 * no plate is fetched, until you actually turn it on.
 *
 * Plates are captured at a fixed 1440px viewport and stored under
 * `public/reference/`. They are therefore only truthful at 1440px, which is why
 * the panel says so when your window is a different width — the live site is
 * responsive too, and a 1440 plate over a 1200 window compares two layouts that
 * never coexisted. Refreshing them is documented in `public/reference/README.md`.
 */

/**
 * Which live page each of our routes is compared against.
 *
 * Keep this in step with `PAGES` in `scripts/capture-reference.mjs` — that
 * script writes the files, this map consumes them, and a route present in one
 * and not the other is the only way the overlay can go quietly wrong.
 */
const LIVE = 'https://www.knowledgegraph.tech';
const PLATES: Record<string, { file: string; capturedAt: number; live: string }> = {
  '/': { file: '/reference/home-1440.webp', capturedAt: 1440, live: `${LIVE}/` },
  '/speakers': { file: '/reference/speakers-1440.webp', capturedAt: 1440, live: `${LIVE}/2026-speakers/` },
  '/about': { file: '/reference/about-1440.webp', capturedAt: 1440, live: `${LIVE}/about-kgc/` },
  '/team': { file: '/reference/team-1440.webp', capturedAt: 1440, live: `${LIVE}/team/` },
  '/community': { file: '/reference/community-1440.webp', capturedAt: 1440, live: `${LIVE}/community/` },
  '/hcls': { file: '/reference/hcls-1440.webp', capturedAt: 1440, live: `${LIVE}/hcls/` },
  '/tickets': { file: '/reference/tickets-1440.webp', capturedAt: 1440, live: `${LIVE}/tickets/` },
  '/blog': { file: '/reference/blog-1440.webp', capturedAt: 1440, live: `${LIVE}/blog/` },
  '/learn': { file: '/reference/learn-1440.webp', capturedAt: 1440, live: `${LIVE}/knowledge-graph-learning-program/` },
  '/agenda': { file: '/reference/agenda-1440.webp', capturedAt: 1440, live: `${LIVE}/agenda/` },
  '/kgc-lifetime-achievement-awards': {
    file: '/reference/awards-1440.webp',
    capturedAt: 1440,
    live: `${LIVE}/kgc-lifetime-achievement-awards/`,
  },
  /*
   * No plate for `/sponsor`: the live site has no sponsor page at all. Its
   * "Sponsor KGC" nav item links straight out to a Coda prospectus, so there is
   * nothing to overlay — ours is an addition, not a replica.
   */
};

const KEY = 'kgc-reference-overlay';

interface OverlayState {
  on: boolean;
  opacity: number;
  difference: boolean;
  dx: number;
  dy: number;
}

const INITIAL: OverlayState = { on: false, opacity: 50, difference: false, dx: 0, dy: 0 };

export function ReferenceOverlay() {
  const pathname = usePathname();
  const plate = PLATES[pathname];
  const [s, setS] = useState<OverlayState>(INITIAL);
  const [width, setWidth] = useState(0);

  /* Settings survive a reload, because nudging into alignment and then losing it
     to a hot reload is the fastest way to stop using a tool like this. */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setS({ ...INITIAL, ...JSON.parse(saved) });
    } catch {
      /* A malformed or blocked localStorage is not worth a crash. */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, [s]);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const nudge = useCallback((dx: number, dy: number) => {
    setS((p) => ({ ...p, dx: p.dx + dx, dy: p.dy + dy }));
  }, []);

  /*
   * Shift+O toggles, arrows nudge by 1px and Shift+arrows by 10. Arrows are only
   * captured while the overlay is on, so the page scrolls normally otherwise.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select');
      if (typing) return;
      if (e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setS((p) => ({ ...p, on: !p.on }));
        return;
      }
      if (!s.on) return;
      const step = e.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const m = moves[e.key];
      if (m) {
        e.preventDefault();
        nudge(m[0], m[1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.on, nudge]);

  if (!plate) {
    /* No plate for this route: say so rather than rendering a dead shortcut. */
    return s.on ? (
      <Panel>
        <strong>No reference plate for {pathname}</strong>
        <p style={{ margin: '6px 0 0', opacity: 0.8 }}>
          Capture one and add it to <code>PLATES</code> in <code>reference-overlay.tsx</code>.
        </p>
        <button onClick={() => setS((p) => ({ ...p, on: false }))} style={btn}>
          Close
        </button>
      </Panel>
    ) : null;
  }

  const offBy = width && width !== plate.capturedAt ? plate.capturedAt - width : 0;

  return (
    <>
      {s.on && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: s.dy,
            left: '50%',
            /* Centred, not left-pinned: our layout centres inside `--max`, so a
               centred plate keeps the two content columns over each other even
               when the window is not exactly the capture width. */
            transform: `translateX(calc(-50% + ${s.dx}px))`,
            width: plate.capturedAt,
            zIndex: 2147483000,
            pointerEvents: 'none',
            opacity: s.opacity / 100,
            mixBlendMode: s.difference ? 'difference' : 'normal',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a raw img: this
              is a dev tool, and next/image would optimise a plate whose whole
              purpose is to be pixel-accurate. */}
          <img src={plate.file} alt="" style={{ width: '100%', display: 'block' }} />
        </div>
      )}

      {s.on ? (
        <Panel>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <strong>Reference overlay</strong>
            <button onClick={() => setS((p) => ({ ...p, on: false }))} style={btnGhost}>
              hide · ⇧O
            </button>
          </div>

          <label style={row}>
            <span>Opacity</span>
            <input
              type="range"
              min={0}
              max={100}
              value={s.opacity}
              onChange={(e) => setS((p) => ({ ...p, opacity: Number(e.target.value) }))}
              style={{ flex: 1 }}
            />
            <span style={num}>{s.opacity}%</span>
          </label>

          <label style={{ ...row, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={s.difference}
              onChange={(e) => setS((p) => ({ ...p, difference: e.target.checked }))}
            />
            <span>
              Difference blend <span style={{ opacity: 0.65 }}>— black means identical</span>
            </span>
          </label>

          <div style={row}>
            <span>
              Offset {s.dx}, {s.dy}
            </span>
            <span style={{ opacity: 0.65, flex: 1 }}>arrows · ⇧ for 10px</span>
            <button onClick={() => setS((p) => ({ ...p, dx: 0, dy: 0 }))} style={btnGhost}>
              reset
            </button>
          </div>

          {offBy !== 0 && (
            <p style={{ margin: '8px 0 0', color: '#ffcf6b' }}>
              Window is {width}px; this plate was captured at {plate.capturedAt}px. Resize to{' '}
              {plate.capturedAt} before trusting any spacing you see.
            </p>
          )}
        </Panel>
      ) : (
        <button
          onClick={() => setS((p) => ({ ...p, on: true }))}
          style={{ ...panelBase, padding: '8px 12px', cursor: 'pointer' }}
        >
          Overlay live site · ⇧O
        </button>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ chrome - */

const panelBase: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  zIndex: 2147483001,
  background: 'rgba(16, 20, 28, 0.94)',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 10,
  font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
  boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
};

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 };
const num: React.CSSProperties = { width: 38, textAlign: 'right' };
const btn: React.CSSProperties = {
  marginTop: 10,
  background: '#fff',
  color: '#111',
  border: 0,
  borderRadius: 6,
  padding: '5px 10px',
  cursor: 'pointer',
  font: 'inherit',
};
const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: '#9fb6d4',
  border: 0,
  cursor: 'pointer',
  font: 'inherit',
  padding: 0,
};

function Panel({ children }: { children: React.ReactNode }) {
  return <div style={{ ...panelBase, padding: 12, width: 320 }}>{children}</div>;
}
